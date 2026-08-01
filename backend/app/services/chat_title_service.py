import asyncio
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.chat import Chat
from app.prompts.chat_title import CHAT_TITLE_SYSTEM_PROMPT
from app.providers.ollama_provider import ollama_provider
from app.repositories.chat_repository import chat_repository


class ChatTitleService:
    _default_title = "New chat"
    _maximum_title_length = 60

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
                text = block.get("text")

                if isinstance(text, str):
                    text_parts.append(text)

        return "".join(text_parts)

    @classmethod
    def _normalise_title(cls, value: str) -> str:
        text = re.sub(
            r"<think>.*?</think>",
            " ",
            value,
            flags=re.IGNORECASE | re.DOTALL,
        )

        if "</think>" in text.lower():
            text = re.split(
                r"</think>",
                text,
                flags=re.IGNORECASE,
            )[-1]

        lines = [line.strip() for line in text.splitlines() if line.strip()]
        title = lines[0] if lines else ""
        title = re.sub(
            r"^(?:title|chat title)\s*:\s*",
            "",
            title,
            flags=re.IGNORECASE,
        )
        title = title.strip(" `\"'*_#-")
        title = re.sub(r"\s+", " ", title)
        title = title.rstrip(" .,:;!?-")

        if len(title) > cls._maximum_title_length:
            title = title[: cls._maximum_title_length + 1]
            title = title.rsplit(" ", 1)[0].rstrip(" .,:;!?-")

        return title

    @classmethod
    def _fallback_title(cls, source: str) -> str:
        clean_source = re.sub(r"\s+", " ", source).strip()
        words = clean_source.split(" ")[:6]
        return cls._normalise_title(" ".join(words)) or cls._default_title

    async def generate_for_first_turn(
        self,
        session: AsyncSession,
        chat_id: int,
        source: str,
        should_generate: bool,
    ) -> Chat | None:
        if not should_generate:
            return None

        try:
            response = await asyncio.wait_for(
                ollama_provider.chat_client.ainvoke(
                    [
                        SystemMessage(content=CHAT_TITLE_SYSTEM_PROMPT),
                        HumanMessage(content=source),
                    ]
                ),
                timeout=8.0,
            )
            generated_title = self._normalise_title(
                self._content_to_text(response.content)
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            generated_title = ""

        title = generated_title or self._fallback_title(source)

        try:
            chat = await chat_repository.get_by_id(
                session=session,
                chat_id=chat_id,
            )

            if chat is None or chat.title != self._default_title:
                return None

            return await chat_repository.update_title(
                session=session,
                chat=chat,
                title=title,
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            await session.rollback()
            return None


chat_title_service = ChatTitleService()
