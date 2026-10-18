from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.memory import Memory


class MemoryPersistenceError(Exception):
    """Expose constraint races without leaking SQL details through the API."""


class MemoryRepository:
    """Own all durable CRUD operations for explicit global memories."""

    async def create(
        self,
        session: AsyncSession,
        values: dict[str, Any],
    ) -> Memory:
        memory = Memory(**values)
        session.add(memory)
        await self._commit(session)
        await session.refresh(memory)
        return memory

    async def list_all(self, session: AsyncSession) -> list[Memory]:
        # Oldest-first ordering is stable and matches injection priority.
        statement = select(Memory).order_by(
            Memory.created_at.asc(),
            Memory.id.asc(),
        )
        result = await session.execute(statement)
        return list(result.scalars().all())

    async def list_enabled(self, session: AsyncSession) -> list[Memory]:
        statement = (
            select(Memory)
            .where(Memory.is_enabled.is_(True))
            .order_by(Memory.created_at.asc(), Memory.id.asc())
        )
        result = await session.execute(statement)
        return list(result.scalars().all())

    async def get_by_id(
        self,
        session: AsyncSession,
        memory_id: int,
    ) -> Memory | None:
        return await session.get(Memory, memory_id)

    async def update(
        self,
        session: AsyncSession,
        memory: Memory,
        values: dict[str, Any],
    ) -> Memory:
        for field_name, value in values.items():
            setattr(memory, field_name, value)

        await self._commit(session)
        await session.refresh(memory)
        return memory

    async def delete(
        self,
        session: AsyncSession,
        memory: Memory,
    ) -> None:
        await session.delete(memory)
        await self._commit(session)

    @staticmethod
    async def _commit(session: AsyncSession) -> None:
        try:
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise MemoryPersistenceError from exc


memory_repository = MemoryRepository()
