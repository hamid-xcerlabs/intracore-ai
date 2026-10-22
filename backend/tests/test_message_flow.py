import os
import tempfile
import unittest
from unittest.mock import patch

from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.models import Chat, Message
from app.db.session import get_database_session
from app.main import app
from app.services.conversation_service import (
    ConversationGenerationError,
    ConversationService,
)


class FailingGraph:
    async def ainvoke(self, state):
        del state
        raise RuntimeError("synthetic model failure")


class MessageFlowTests(unittest.IsolatedAsyncioTestCase):
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

        async def test_database_session():
            async with self.sessions() as session:
                yield session

        app.dependency_overrides[get_database_session] = test_database_session

    async def asyncTearDown(self) -> None:
        app.dependency_overrides.pop(get_database_session, None)
        await self.engine.dispose()
        os.unlink(self.database_path)

    async def _create_chat(self) -> Chat:
        async with self.sessions() as session:
            chat = Chat(title="Message flow")
            session.add(chat)
            await session.commit()
            await session.refresh(chat)
            return chat

    async def test_generation_failure_keeps_user_message_only(self):
        chat = await self._create_chat()

        with patch(
            "app.services.conversation_service.chat_graph",
            FailingGraph(),
        ):
            with self.assertRaises(ConversationGenerationError):
                async with self.sessions() as session:
                    loaded_chat = await session.get(Chat, chat.id)
                    await ConversationService().create_durable_turn(
                        session,
                        loaded_chat,
                        "This must remain durable.",
                        "synthetic-model",
                    )

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
            self.assertEqual(len(messages), 1)
            self.assertEqual(messages[0].role, "user")

    async def test_message_input_rejects_blank_and_oversized_content(self):
        chat = await self._create_chat()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            blank = await client.post(
                f"/chats/{chat.id}/messages",
                json={"content": "   "},
            )
            oversized = await client.post(
                f"/chats/{chat.id}/messages",
                json={"content": "x" * 100_001},
            )

        self.assertEqual(blank.status_code, 422)
        self.assertEqual(oversized.status_code, 422)


if __name__ == "__main__":
    unittest.main()
