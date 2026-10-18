from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_database_session
from app.repositories.memory_repository import MemoryPersistenceError
from app.schemas.memories import MemoryCreate, MemoryResponse, MemoryUpdate
from app.services.memory_service import (
    MemoryNotFoundError,
    MemorySourceMismatchError,
    MemorySourceNotFoundError,
    memory_service,
)


DatabaseSession = Annotated[AsyncSession, Depends(get_database_session)]
router = APIRouter(prefix="/memories", tags=["Memories"])


def memory_http_error(exc: Exception) -> HTTPException:
    """Map service/repository failures to controlled public API errors."""

    if isinstance(exc, MemoryNotFoundError):
        return HTTPException(status_code=404, detail="Memory not found.")
    if isinstance(exc, MemorySourceNotFoundError):
        return HTTPException(
            status_code=422,
            detail="Memory source chat or message was not found.",
        )
    if isinstance(exc, MemorySourceMismatchError):
        return HTTPException(
            status_code=422,
            detail="Source message does not belong to source chat.",
        )
    return HTTPException(
        status_code=409,
        detail="Memory could not be saved because its source changed.",
    )


@router.get("", response_model=list[MemoryResponse])
async def list_memories(session: DatabaseSession) -> list[MemoryResponse]:
    memories = await memory_service.list_all(session)
    return [MemoryResponse.model_validate(memory) for memory in memories]


@router.post("", response_model=MemoryResponse, status_code=status.HTTP_201_CREATED)
async def create_memory(
    request: MemoryCreate,
    session: DatabaseSession,
) -> MemoryResponse:
    try:
        memory = await memory_service.create(session, request)
    except (
        MemorySourceNotFoundError,
        MemorySourceMismatchError,
        MemoryPersistenceError,
    ) as exc:
        raise memory_http_error(exc) from exc
    return MemoryResponse.model_validate(memory)


@router.patch("/{memory_id}", response_model=MemoryResponse)
async def update_memory(
    memory_id: int,
    request: MemoryUpdate,
    session: DatabaseSession,
) -> MemoryResponse:
    try:
        memory = await memory_service.update(session, memory_id, request)
    except (
        MemoryNotFoundError,
        MemorySourceNotFoundError,
        MemorySourceMismatchError,
        MemoryPersistenceError,
    ) as exc:
        raise memory_http_error(exc) from exc
    return MemoryResponse.model_validate(memory)


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(memory_id: int, session: DatabaseSession) -> Response:
    try:
        await memory_service.delete(session, memory_id)
    except MemoryNotFoundError as exc:
        raise memory_http_error(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
