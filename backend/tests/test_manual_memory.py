import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from httpx import ASGITransport, AsyncClient
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage
from pydantic import ValidationError
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.models import Chat, Memory, Message
from app.db.session import get_database_session
from app.graph.chat_graph import generate_response
from app.main import app
from app.prompts.system import INTRACORE_SYSTEM_PROMPT
from app.repositories.memory_repository import memory_repository
from app.repositories.message_repository import message_repository
from app.schemas.memories import MemoryCreate, MemoryUpdate
from app.services.conversation_service import ConversationService
from app.services.memory_service import memory_service


class CapturingClient:
    """Capture graph input without contacting a real Ollama runtime."""

    def __init__(self) -> None:
        self.messages = []

    async def ainvoke(self, messages, **kwargs):
        del kwargs
        self.messages = messages
        return AIMessage(content="captured answer")


class CapturingGraph:
    """Exercise conversation orchestration while replacing model generation."""

    def __init__(self) -> None:
        self.non_streaming_state = None
        self.streaming_state = None

    async def ainvoke(self, state):
        self.non_streaming_state = state
        return {"messages": [AIMessage(content="durable answer")]}

    def astream(self, state, stream_mode):
        self.streaming_state = state
        if stream_mode != "messages":
            raise AssertionError("Unexpected graph streaming mode")
        return self._chunks()

    async def _chunks(self):
        yield (
            AIMessageChunk(content="streamed answer"),
            {"langgraph_node": "generate_response"},
        )


class ManualMemoryTests(unittest.IsolatedAsyncioTestCase):
    """Verify memory CRUD, lifecycle, isolation, and prompt integration."""

    async def asyncSetUp(self) -> None:
        # A temporary SQLite file exercises production-like foreign keys
        # without reading or changing the user's authoritative local database.
        handle = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.database_path = handle.name
        handle.close()
        normalized_path = self.database_path.replace(os.sep, "/")
        self.engine = create_async_engine(
            f"sqlite+aiosqlite:///{normalized_path}"
        )

        @event.listens_for(self.engine.sync_engine, "connect")
        def enable_foreign_keys(dbapi_connection, connection_record) -> None:
            del connection_record
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        self.sessions = async_sessionmaker(
            self.engine,
            expire_on_commit=False,
        )
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def asyncTearDown(self) -> None:
        await self.engine.dispose()
        os.unlink(self.database_path)

    async def _create_chat(self, title: str) -> int:
        async with self.sessions() as session:
            chat = Chat(title=title)
            session.add(chat)
            await session.commit()
            await session.refresh(chat)
            return chat.id

    async def test_schemas_reject_invalid_requests(self):
        with self.assertRaises(ValidationError):
            MemoryCreate(content="   ", kind="fact")
        with self.assertRaises(ValidationError):
            MemoryCreate(content="valid", kind="unsupported")
        with self.assertRaises(ValidationError):
            MemoryUpdate()

    async def test_create_list_update_disable_and_hard_delete(self):
        async with self.sessions() as session:
            created = await memory_service.create(
                session,
                MemoryCreate(
                    content="  Prefer concise answers.  ",
                    kind="preference",
                ),
            )
            self.assertEqual(created.content, "Prefer concise answers.")
            listed = await memory_service.list_all(session)
            self.assertEqual([item.id for item in listed], [created.id])

            updated = await memory_service.update(
                session,
                created.id,
                MemoryUpdate(
                    content="Prefer detailed answers.",
                    is_enabled=False,
                ),
            )
            self.assertEqual(updated.content, "Prefer detailed answers.")
            self.assertFalse(updated.is_enabled)
            self.assertEqual(await memory_service.build_context(session), "")

            await memory_service.delete(session, created.id)
            self.assertEqual(await memory_service.list_all(session), [])
            self.assertEqual(await memory_service.build_context(session), "")

    async def test_memory_api_crud_and_validation_contracts(self):
        # Override only the request-scoped session dependency so the real
        # FastAPI router is exercised against this test's isolated database.
        async def test_database_session():
            async with self.sessions() as session:
                yield session

        app.dependency_overrides[get_database_session] = test_database_session
        transport = ASGITransport(app=app)

        try:
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
            ) as client:
                blank = await client.post(
                    "/memories",
                    json={"content": "   ", "kind": "fact"},
                )
                invalid_kind = await client.post(
                    "/memories",
                    json={"content": "Valid", "kind": "unknown"},
                )
                empty_update = await client.patch(
                    "/memories/1",
                    json={},
                )
                self.assertEqual(blank.status_code, 422)
                self.assertEqual(invalid_kind.status_code, 422)
                self.assertEqual(empty_update.status_code, 422)

                created = await client.post(
                    "/memories",
                    json={
                        "content": "  API memory  ",
                        "kind": "fact",
                    },
                )
                self.assertEqual(created.status_code, 201)
                memory = created.json()
                self.assertEqual(memory["content"], "API memory")
                self.assertTrue(memory["is_enabled"])

                listed = await client.get("/memories")
                self.assertEqual(listed.status_code, 200)
                self.assertEqual(
                    [item["id"] for item in listed.json()],
                    [memory["id"]],
                )

                updated = await client.patch(
                    f"/memories/{memory['id']}",
                    json={
                        "content": "Updated API memory",
                        "kind": "instruction",
                        "is_enabled": False,
                    },
                )
                self.assertEqual(updated.status_code, 200)
                self.assertEqual(
                    updated.json()["content"],
                    "Updated API memory",
                )
                self.assertFalse(updated.json()["is_enabled"])

                deleted = await client.delete(
                    f"/memories/{memory['id']}"
                )
                self.assertEqual(deleted.status_code, 204)
                self.assertEqual((await client.get("/memories")).json(), [])

                missing = await client.patch(
                    f"/memories/{memory['id']}",
                    json={"is_enabled": True},
                )
                self.assertEqual(missing.status_code, 404)
        finally:
            app.dependency_overrides.pop(get_database_session, None)

    async def test_context_is_bounded_and_chat_messages_stay_isolated(self):
        chat_a_id = await self._create_chat("Chat A")
        chat_b_id = await self._create_chat("Chat B")

        async with self.sessions() as session:
            session.add_all(
                [
                    Message(
                        chat_id=chat_a_id,
                        role="user",
                        content="Only Chat A knows this",
                        sequence_number=1,
                    ),
                    Message(
                        chat_id=chat_b_id,
                        role="user",
                        content="Only Chat B knows this",
                        sequence_number=1,
                    ),
                ]
            )
            await session.commit()
            first = await memory_service.create(
                session,
                MemoryCreate(content="First global fact", kind="fact"),
            )
            second = await memory_service.create(
                session,
                MemoryCreate(
                    content="Second global preference",
                    kind="preference",
                ),
            )

            context = await memory_service.build_context(session)
            self.assertLess(
                context.index(f"#{first.id}"),
                context.index(f"#{second.id}"),
            )
            messages_a = await message_repository.list_for_chat(
                session, chat_a_id
            )
            messages_b = await message_repository.list_for_chat(
                session, chat_b_id
            )
            self.assertEqual(
                [item.content for item in messages_a],
                ["Only Chat A knows this"],
            )
            self.assertEqual(
                [item.content for item in messages_b],
                ["Only Chat B knows this"],
            )

            first_entry = f"\n\n- [FACT #{first.id}] {first.content}"
            exact_budget = len(memory_service._context_header) + len(first_entry)
            with patch(
                "app.services.memory_service.get_settings",
                return_value=SimpleNamespace(
                    memory_context_max_chars=exact_budget
                ),
            ):
                bounded = await memory_service.build_context(session)
            self.assertIn(first.content, bounded)
            self.assertNotIn(second.content, bounded)
            self.assertEqual(len(bounded), exact_budget)

    async def test_source_foreign_keys_become_null_after_deletion(self):
        chat_id = await self._create_chat("Source chat")
        async with self.sessions() as session:
            message = Message(
                chat_id=chat_id,
                role="user",
                content="Source message",
                sequence_number=1,
            )
            session.add(message)
            await session.commit()
            await session.refresh(message)
            memory = await memory_service.create(
                session,
                MemoryCreate(
                    content="Sourced memory",
                    kind="fact",
                    source_chat_id=chat_id,
                    source_message_id=message.id,
                ),
            )
            memory_id = memory.id
            await session.delete(message)
            await session.commit()

        async with self.sessions() as session:
            memory = await memory_repository.get_by_id(session, memory_id)
            self.assertIsNotNone(memory)
            self.assertIsNone(memory.source_message_id)
            self.assertEqual(memory.source_chat_id, chat_id)
            chat = await session.get(Chat, chat_id)
            await session.delete(chat)
            await session.commit()

        async with self.sessions() as session:
            memory = await memory_repository.get_by_id(session, memory_id)
            self.assertIsNotNone(memory)
            self.assertIsNone(memory.source_chat_id)
            self.assertIsNone(memory.source_message_id)

    async def test_core_prompt_precedes_memory_and_chat_history(self):
        client = CapturingClient()
        with patch(
            "app.graph.chat_graph.ollama_provider.create_chat_client",
            return_value=client,
        ):
            await generate_response(
                {
                    "messages": [HumanMessage(content="Current chat message")],
                    "memory_context": "USER-PROVIDED MEMORY CONTEXT",
                    "model_name": "synthetic-model",
                }
            )

        self.assertEqual(client.messages[0].content, INTRACORE_SYSTEM_PROMPT)
        self.assertEqual(
            client.messages[1].content,
            "USER-PROVIDED MEMORY CONTEXT",
        )
        self.assertEqual(client.messages[2].content, "Current chat message")

    async def test_both_generation_paths_receive_memory_context(self):
        non_stream_chat_id = await self._create_chat("Existing non-stream")
        stream_chat_id = await self._create_chat("Existing stream")
        graph = CapturingGraph()

        async with self.sessions() as session:
            await memory_service.create(
                session,
                MemoryCreate(
                    content="Shared across both paths",
                    kind="instruction",
                ),
            )
            chat = await session.get(Chat, non_stream_chat_id)
            service = ConversationService()
            with patch("app.services.conversation_service.chat_graph", graph):
                user, assistant = await service.create_durable_turn(
                    session,
                    chat,
                    "Non-stream question",
                    "synthetic-model",
                )

            self.assertEqual(user.role, "user")
            self.assertEqual(assistant.role, "assistant")
            self.assertIn(
                "Shared across both paths",
                graph.non_streaming_state["memory_context"],
            )

        async with self.sessions() as session:
            chat = await session.get(Chat, stream_chat_id)
            service = ConversationService()
            prepared = await service.prepare_durable_turn(
                session,
                chat,
                "Stream question",
            )

            async def keep_running() -> bool:
                return False

            with patch("app.services.conversation_service.chat_graph", graph):
                items = [
                    item
                    async for item in service.stream_durable_assistant(
                        session=session,
                        chat_id=stream_chat_id,
                        graph_messages=prepared.graph_messages,
                        memory_context=prepared.memory_context,
                        title_source=prepared.title_source,
                        should_generate_title=False,
                        model_name="synthetic-model",
                        should_stop=keep_running,
                    )
                ]

            self.assertIn(
                "Shared across both paths",
                graph.streaming_state["memory_context"],
            )
            saved = [item for item in items if isinstance(item, Message)]
            self.assertEqual(len(saved), 1)
            self.assertEqual(saved[0].content, "streamed answer")


if __name__ == "__main__":
    unittest.main()
