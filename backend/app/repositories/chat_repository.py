# select creates SQLAlchemy ORM SELECT statements.
from sqlalchemy import select

# AsyncSession executes queries and controls transactions.
from sqlalchemy.ext.asyncio import AsyncSession

# Chat is the authoritative ORM representation of the chats table.
from app.db.models.chat import Chat


# ChatRepository contains reusable chat persistence operations.
# API routes call this layer rather than embedding SQL queries directly.
class ChatRepository:
    # Create and persist one new conversation.
    async def create(
        self,
        session: AsyncSession,
        title: str,
    ) -> Chat:
        # Build a new ORM object in memory.
        chat = Chat(title=title)

        # Register the object with the current database session.
        session.add(chat)

        # Commit the transaction so the row becomes durable in SQLite.
        await session.commit()

        # Reload database-generated fields such as id and timestamps.
        await session.refresh(chat)

        # Return the persisted ORM object to the route layer.
        return chat

    # Return every chat ordered by the most recently updated conversation.
    async def list_all(
        self,
        session: AsyncSession,
    ) -> list[Chat]:
        # Build an ORM query rather than writing raw SQL strings.
        statement = select(Chat).order_by(
            Chat.updated_at.desc(),
            Chat.id.desc(),
        )

        # Execute the query asynchronously.
        result = await session.execute(statement)

        # scalars() extracts Chat objects; all() returns the complete list.
        return list(result.scalars().all())

    # Find one conversation by its durable primary key.
    async def get_by_id(
        self,
        session: AsyncSession,
        chat_id: int,
    ) -> Chat | None:
        # AsyncSession.get is efficient for primary-key lookup.
        return await session.get(Chat, chat_id)

    # Rename one existing conversation.
    async def update_title(
        self,
        session: AsyncSession,
        chat: Chat,
        title: str,
    ) -> Chat:
        # Update the tracked ORM object's title.
        chat.title = title

        # Commit the durable change.
        await session.commit()

        # Reload timestamps and other database-generated values.
        await session.refresh(chat)

        # Return the updated conversation.
        return chat

    # Delete one conversation and its related messages.
    async def delete(
        self,
        session: AsyncSession,
        chat: Chat,
    ) -> None:
        # Mark the tracked ORM object for deletion.
        await session.delete(chat)

        # Commit the deletion to SQLite.
        # The foreign-key cascade will later delete associated messages.
        await session.commit()


# Export one stateless repository instance for route reuse.
chat_repository = ChatRepository()