# select creates SQLAlchemy ORM SELECT statements.
from sqlalchemy import func, select

# IntegrityError identifies database constraint conflicts during commits.
from sqlalchemy.exc import IntegrityError

# AsyncSession executes database queries asynchronously.
from sqlalchemy.ext.asyncio import AsyncSession

# Message is the authoritative ORM representation of durable messages.
from app.db.models.chat import Chat
from app.db.models.message import Message


# MessageSequenceConflictError exposes a controlled repository-level conflict.
class MessageSequenceConflictError(Exception):
    pass


# MessageRepository contains reusable read operations for durable messages.
class MessageRepository:
    # Return one chat's messages in stable conversation order.
    async def list_for_chat(
        self,
        session: AsyncSession,
        chat_id: int,
    ) -> list[Message]:
        # Filter by the parent chat and sort by the durable sequence number.
        statement = (
            select(Message)
            .where(Message.chat_id == chat_id)
            .order_by(Message.sequence_number.asc())
        )

        # Execute the query and extract Message ORM objects.
        result = await session.execute(statement)

        return list(result.scalars().all())

    # Calculate the next sequence number for the current local single-user flow.
    async def _get_next_sequence_number(
        self,
        session: AsyncSession,
        chat_id: int,
    ) -> int:
        # MAX + 1 is acceptable for the current local single-user version.
        # The database unique constraint remains the final collision guard.
        statement = select(
            func.coalesce(
                func.max(Message.sequence_number),
                0,
            ) + 1
        ).where(Message.chat_id == chat_id)

        result = await session.execute(statement)

        return int(result.scalar_one())

    # Save one user message and update its chat in one short transaction.
    async def create_user_message(
        self,
        session: AsyncSession,
        chat: Chat,
        content: str,
    ) -> Message:
        sequence_number = await self._get_next_sequence_number(
            session=session,
            chat_id=chat.id,
        )

        # Role and model attribution are controlled by the backend.
        message = Message(
            chat_id=chat.id,
            role="user",
            content=content,
            sequence_number=sequence_number,
            model_name=None,
        )

        # The tracked Chat update and Message insert share one commit.
        chat.updated_at = func.now()
        session.add(message)

        try:
            await session.commit()
        except IntegrityError as exc:
            # Restore a usable session after a unique-sequence collision.
            await session.rollback()
            raise MessageSequenceConflictError from exc

        # Reload database-generated fields such as id and created_at.
        await session.refresh(message)

        return message

# Export one stateless repository instance for route reuse.
message_repository = MessageRepository()
