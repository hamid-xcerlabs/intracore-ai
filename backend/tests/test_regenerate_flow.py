import os
import tempfile
import unittest
from unittest.mock import patch

from langchain_core.messages import AIMessageChunk, HumanMessage
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.models import Chat, Message
from app.services.conversation_service import ConversationService


class ReplacementGraph:
    def astream(self, state, stream_mode):
        del state
        if stream_mode != "messages":
            raise AssertionError("Unexpected stream mode")
        return self._chunks()

    async def _chunks(self):
        yield (
            AIMessageChunk(content="replacement answer"),
            {"langgraph_node": "generate_response"},
        )


class RegenerateFlowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        handle = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.database_path = handle.name
        handle.close()
        normalized_path = self.database_path.replace(os.sep, "/")
        self.engine = create_async_engine(
            f"sqlite+aiosqlite:///{normalized_path}"
        )
        self.sessions = async_sessionmaker(
            self.engine,
            expire_on_commit=False,
        )
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def asyncTearDown(self) -> None:
        await self.engine.dispose()
        os.unlink(self.database_path)

    async def test_previous_answer_is_replaced_only_after_success(self):
        async with self.sessions() as session:
            chat = Chat(title="Regenerate")
            session.add(chat)
            await session.commit()
            await session.refresh(chat)
            old_assistant = Message(
                chat_id=chat.id,
                role="assistant",
                content="previous answer",
                sequence_number=2,
                model_name="old-model",
            )
            session.add_all(
                [
                    Message(
                        chat_id=chat.id,
                        role="user",
                        content="same question",
                        sequence_number=1,
                    ),
                    old_assistant,
                ]
            )
            await session.commit()
            await session.refresh(old_assistant)

            async def should_stop() -> bool:
                return False

            service = ConversationService()
            with patch(
                "app.services.conversation_service.chat_graph",
                ReplacementGraph(),
            ):
                items = [
                    item
                    async for item in service.stream_durable_assistant(
                        session=session,
                        chat_id=chat.id,
                        graph_messages=[HumanMessage(content="same question")],
                        memory_context="",
                        title_source="same question",
                        should_generate_title=False,
                        model_name="new-model",
                        should_stop=should_stop,
                        replace_message_id=old_assistant.id,
                    )
                ]

            self.assertTrue(any(item == "replacement answer" for item in items))

        async with self.sessions() as session:
            messages = list(
                (
                    await session.execute(
                        select(Message)
                        .where(Message.chat_id == chat.id)
                        .order_by(Message.sequence_number)
                    )
                ).scalars()
            )
            self.assertEqual([message.content for message in messages], [
                "same question",
                "replacement answer",
            ])


if __name__ == "__main__":
    unittest.main()
