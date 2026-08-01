import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from langchain_core.messages import (
    AIMessage,
    AnyMessage,
    HumanMessage,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.chat import Chat
from app.db.models.message import Message
from app.graph.chat_graph import chat_graph
from app.repositories.message_repository import (
    MessageSequenceConflictError,
    message_repository,
)
from app.services.chat_title_service import chat_title_service


class ConversationGenerationError(Exception):
    """Hide graph/provider failures behind a controlled service boundary."""


class ConversationStoppedError(Exception):
    """Signal best-effort cancellation before assistant persistence."""


@dataclass(frozen=True)
class PreparedConversationTurn:
    """Committed user record plus the ordered graph-ready history."""

    user_message: Message
    graph_messages: list[AnyMessage]
    should_generate_title: bool
    title_source: str


@dataclass(frozen=True)
class ConversationTitleUpdate:
    """A persisted chat title emitted after a successful durable turn."""

    chat: Chat


class AnswerTextFilter:
    """Pass answer text while suppressing a leading legacy think block."""

    _opening_tag = "<think>"
    _closing_tag = "</think>"

    def __init__(self) -> None:
        self._mode = "detecting"
        self._buffer = ""

    def feed(self, text: str) -> str:
        if not text:
            return ""

        if self._mode == "answer":
            return text

        if self._mode == "detecting":
            self._buffer += text
            candidate = self._buffer.lstrip()
            candidate_lower = candidate.lower()

            if not candidate:
                return ""

            if candidate_lower.startswith(self._opening_tag):
                self._mode = "reasoning"
                remainder = candidate[len(self._opening_tag):]
                self._buffer = ""
                return self.feed(remainder)

            if self._opening_tag.startswith(candidate_lower):
                return ""

            self._mode = "answer"
            answer = self._buffer
            self._buffer = ""
            return answer

        self._buffer += text
        closing_index = self._buffer.lower().find(self._closing_tag)

        if closing_index < 0:
            # Retain only the suffix needed to detect a split closing tag.
            self._buffer = self._buffer[-(len(self._closing_tag) - 1):]
            return ""

        self._mode = "answer"
        answer = self._buffer[
            closing_index + len(self._closing_tag):
        ]
        self._buffer = ""
        return answer

    def finish(self) -> str:
        if self._mode == "reasoning":
            raise ConversationGenerationError(
                "The model returned an incomplete reasoning block."
            )

        if self._mode == "detecting":
            candidate = self._buffer.lstrip().lower()

            if candidate and self._opening_tag.startswith(candidate):
                raise ConversationGenerationError(
                    "The model returned an incomplete reasoning tag."
                )

            answer = self._buffer
            self._buffer = ""
            self._mode = "answer"
            return answer

        return ""


class ConversationService:
    @staticmethod
    def _to_graph_messages(
        durable_history: list[Message],
    ) -> list[AnyMessage]:
        graph_messages: list[AnyMessage] = []

        for message in durable_history:
            if message.role == "user":
                graph_messages.append(
                    HumanMessage(content=message.content)
                )
            elif message.role == "assistant":
                graph_messages.append(
                    AIMessage(content=message.content)
                )

        return graph_messages

    @staticmethod
    def _content_to_text(content: Any) -> str:
        if isinstance(content, str):
            return content

        if not isinstance(content, list):
            return ""

        text_parts: list[str] = []

        for block in content:
            if isinstance(block, str):
                text_parts.append(block)
            elif isinstance(block, dict):
                block_text = block.get("text")

                if isinstance(block_text, str):
                    text_parts.append(block_text)

        return "".join(text_parts)

    async def prepare_durable_turn(
        self,
        session: AsyncSession,
        chat: Chat,
        content: str,
    ) -> PreparedConversationTurn:
        # The user commit intentionally survives generation failure or stop.
        user_message = await message_repository.create_user_message(
            session=session,
            chat=chat,
            content=content,
        )

        durable_history = await message_repository.list_for_chat(
            session=session,
            chat_id=chat.id,
        )

        first_user_message = next(
            (
                message
                for message in durable_history
                if message.role == "user"
            ),
            user_message,
        )

        # Close the read transaction before slow model work begins.
        await session.commit()

        return PreparedConversationTurn(
            user_message=user_message,
            graph_messages=self._to_graph_messages(durable_history),
            should_generate_title=(chat.title == "New chat"),
            title_source=first_user_message.content,
        )

    async def _save_assistant(
        self,
        session: AsyncSession,
        chat_id: int,
        content: str,
        model_name: str,
    ) -> Message:
        return await message_repository.create_assistant_message(
            session=session,
            chat_id=chat_id,
            content=content,
            model_name=model_name,
        )

    async def create_durable_turn(
        self,
        session: AsyncSession,
        chat: Chat,
        content: str,
        model_name: str,
    ) -> tuple[Message, Message]:
        prepared = await self.prepare_durable_turn(
            session=session,
            chat=chat,
            content=content,
        )

        try:
            result = await chat_graph.ainvoke(
                {
                    "messages": prepared.graph_messages,
                    "model_name": model_name,
                }
            )
            final_message = result["messages"][-1]
            answer_filter = AnswerTextFilter()
            assistant_content = answer_filter.feed(
                self._content_to_text(final_message.content)
            ) + answer_filter.finish()

            if not assistant_content.strip():
                raise ConversationGenerationError(
                    "The model returned no answer text."
                )

            assistant_message = await self._save_assistant(
                session=session,
                chat_id=chat.id,
                content=assistant_content,
                model_name=model_name,
            )

            await chat_title_service.generate_for_first_turn(
                session=session,
                chat_id=chat.id,
                source=prepared.title_source,
                should_generate=prepared.should_generate_title,
                model_name=model_name,
            )
        except MessageSequenceConflictError:
            raise
        except ConversationGenerationError:
            await session.rollback()
            raise
        except Exception as exc:
            await session.rollback()
            raise ConversationGenerationError from exc

        return prepared.user_message, assistant_message

    async def stream_durable_assistant(
        self,
        session: AsyncSession,
        chat_id: int,
        graph_messages: list[AnyMessage],
        title_source: str,
        should_generate_title: bool,
        model_name: str,
        should_stop: Callable[[], Awaitable[bool]],
    ) -> AsyncIterator[str | Message | ConversationTitleUpdate]:
        answer_filter = AnswerTextFilter()
        answer_parts: list[str] = []
        graph_stream = chat_graph.astream(
            {
                "messages": graph_messages,
                "model_name": model_name,
            },
            stream_mode="messages",
        )

        try:
            async for chunk, metadata in graph_stream:
                if await should_stop():
                    raise ConversationStoppedError

                if metadata.get("langgraph_node") != "generate_response":
                    continue

                # reasoning_content is deliberately ignored. Only visible
                # answer content is allowed into API events or persistence.
                visible_text = answer_filter.feed(
                    self._content_to_text(chunk.content)
                )

                if visible_text:
                    answer_parts.append(visible_text)
                    yield visible_text

            if await should_stop():
                raise ConversationStoppedError

            final_text = answer_filter.finish()

            if final_text:
                answer_parts.append(final_text)
                yield final_text

            assistant_content = "".join(answer_parts)

            if not assistant_content.strip():
                raise ConversationGenerationError(
                    "The model returned no answer text."
                )

            # Check once more immediately before the only assistant write.
            if await should_stop():
                raise ConversationStoppedError

            assistant_message = await self._save_assistant(
                session=session,
                chat_id=chat_id,
                content=assistant_content,
                model_name=model_name,
            )
            yield assistant_message

            updated_chat = await chat_title_service.generate_for_first_turn(
                session=session,
                chat_id=chat_id,
                source=title_source,
                should_generate=should_generate_title,
                model_name=model_name,
            )

            if updated_chat is not None:
                yield ConversationTitleUpdate(chat=updated_chat)
        except (ConversationStoppedError, asyncio.CancelledError):
            # Closing the graph stream is best effort. Some Ollama runtimes may
            # continue model computation after the HTTP client disconnects.
            try:
                await graph_stream.aclose()
            except BaseException:
                pass

            try:
                await session.rollback()
            except BaseException:
                pass

            raise
        except MessageSequenceConflictError:
            raise
        except ConversationGenerationError:
            await session.rollback()
            raise
        except Exception as exc:
            await session.rollback()
            raise ConversationGenerationError from exc


conversation_service = ConversationService()
