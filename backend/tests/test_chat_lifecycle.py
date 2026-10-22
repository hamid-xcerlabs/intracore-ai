import os
import tempfile
import unittest

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.models import Chat, Message
from app.db.session import get_database_session
from app.main import app


class ChatLifecycleTests(unittest.IsolatedAsyncioTestCase):
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

        self.override = test_database_session
        app.dependency_overrides[get_database_session] = self.override

    async def asyncTearDown(self) -> None:
        app.dependency_overrides.pop(get_database_session, None)
        await self.engine.dispose()
        os.unlink(self.database_path)

    async def test_single_chat_responses_keep_message_count_current(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            created = await client.post("/chats", json={"title": "Lifecycle"})
            self.assertEqual(created.status_code, 201)
            chat_id = created.json()["id"]

            async with self.sessions() as session:
                session.add(
                    Message(
                        chat_id=chat_id,
                        role="user",
                        content="Persisted message",
                        sequence_number=1,
                    )
                )
                await session.commit()

            fetched = await client.get(f"/chats/{chat_id}")
            self.assertEqual(fetched.status_code, 200)
            self.assertEqual(fetched.json()["message_count"], 1)

            renamed = await client.patch(
                f"/chats/{chat_id}",
                json={"title": "Renamed"},
            )
            self.assertEqual(renamed.status_code, 200)
            self.assertEqual(renamed.json()["message_count"], 1)

            listed = await client.get("/chats")
            self.assertEqual(listed.status_code, 200)
            self.assertEqual(listed.json()[0]["message_count"], 1)

            deleted = await client.delete(f"/chats/{chat_id}")
            self.assertEqual(deleted.status_code, 204)
            missing = await client.get(f"/chats/{chat_id}")
            self.assertEqual(missing.status_code, 404)

    async def test_whitespace_titles_are_rejected(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            created = await client.post("/chats", json={"title": "   "})
            self.assertEqual(created.status_code, 422)


if __name__ == "__main__":
    unittest.main()
