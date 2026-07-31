# Annotated lets FastAPI attach dependency metadata to typed parameters.
from typing import Annotated

# APIRouter groups conversation endpoints.
# Depends injects one request-scoped database session.
# HTTPException returns controlled not-found responses.
# Response provides an empty 204 response after deletion.
from fastapi import APIRouter, Depends, HTTPException, Response, status

# AsyncSession is the database session type injected into each endpoint.
from sqlalchemy.ext.asyncio import AsyncSession

# get_database_session controls session creation, rollback, and cleanup.
from app.db.session import get_database_session

# The repository owns reusable SQLAlchemy persistence operations.
from app.repositories.chat_repository import chat_repository
from app.repositories.message_repository import (
    MessageSequenceConflictError,
    message_repository,
)

# Pydantic schemas validate incoming and outgoing HTTP data.
from app.schemas.chats import ChatCreate, ChatResponse, ChatUpdate
from app.schemas.messages import (
    DurableGenerationResponse,
    MessageCreate,
    MessageResponse,
)

# ConversationService owns the complete durable AI generation workflow.
from app.services.conversation_service import (
    ConversationGenerationError,
    conversation_service,
)


# Create one reusable typed alias for database-session dependency injection.
DatabaseSession = Annotated[
    AsyncSession,
    Depends(get_database_session),
]


# All endpoints in this router begin with /chats.
router = APIRouter(
    prefix="/chats",
    tags=["Chats"],
)


# POST /chats creates one durable conversation.
@router.post(
    "",
    response_model=ChatResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_chat(
    request: ChatCreate,
    session: DatabaseSession,
) -> ChatResponse:
    # Remove accidental leading and trailing spaces from the title.
    clean_title = request.title.strip()

    # Reject a title containing only whitespace.
    if not clean_title:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Chat title cannot be empty.",
        )

    # Delegate durable creation to the repository layer.
    chat = await chat_repository.create(
        session=session,
        title=clean_title,
    )

    # Convert the ORM object into the stable public response schema.
    return ChatResponse.model_validate(chat)


# GET /chats returns all persistent conversations.
@router.get(
    "",
    response_model=list[ChatResponse],
)
async def list_chats(
    session: DatabaseSession,
) -> list[ChatResponse]:
    # Load chats through the repository rather than querying in the route.
    chats = await chat_repository.list_all(session)

    # Convert each ORM object into a validated API response.
    return [
        ChatResponse.model_validate(chat)
        for chat in chats
    ]


# GET /chats/{chat_id}/messages returns one conversation's durable history.
@router.get(
    "/{chat_id}/messages",
    response_model=list[MessageResponse],
)
async def list_chat_messages(
    chat_id: int,
    session: DatabaseSession,
) -> list[MessageResponse]:
    # Verify that the parent conversation exists before loading its history.
    chat = await chat_repository.get_by_id(
        session=session,
        chat_id=chat_id,
    )

    # Distinguish a missing chat from an existing chat with no messages.
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found.",
        )

    # Load durable messages in ascending sequence-number order.
    messages = await message_repository.list_for_chat(
        session=session,
        chat_id=chat_id,
    )

    # Convert ORM objects into the stable public response contract.
    return [
        MessageResponse.model_validate(message)
        for message in messages
    ]


# POST /chats/{chat_id}/messages creates one complete durable AI turn.
@router.post(
    "/{chat_id}/messages",
    response_model=DurableGenerationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_chat_message(
    chat_id: int,
    request: MessageCreate,
    session: DatabaseSession,
) -> DurableGenerationResponse:
    # Verify the parent conversation before attempting a write.
    chat = await chat_repository.get_by_id(
        session=session,
        chat_id=chat_id,
    )

    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found.",
        )

    # Normalise input and reject content containing only whitespace.
    clean_content = request.content.strip()

    if not clean_content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Message content cannot be empty.",
        )

    try:
        user_message, assistant_message = (
            await conversation_service.create_durable_turn(
                session=session,
                chat=chat,
                content=clean_content,
            )
        )
    except MessageSequenceConflictError as exc:
        # The failing message transaction has been rolled back.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Message sequence conflict. Please retry.",
        ) from exc
    except ConversationGenerationError as exc:
        # The service has retained the committed user message.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Assistant generation failed. "
                "Your message was saved."
            ),
        ) from exc

    return DurableGenerationResponse(
        user_message=MessageResponse.model_validate(user_message),
        assistant_message=MessageResponse.model_validate(
            assistant_message
        ),
    )


# GET /chats/{chat_id} returns one persistent conversation.
@router.get(
    "/{chat_id}",
    response_model=ChatResponse,
)
async def get_chat(
    chat_id: int,
    session: DatabaseSession,
) -> ChatResponse:
    # Query the requested conversation.
    chat = await chat_repository.get_by_id(
        session=session,
        chat_id=chat_id,
    )

    # Return a clear HTTP 404 when the identifier does not exist.
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found.",
        )

    # Convert the ORM object into the public response contract.
    return ChatResponse.model_validate(chat)


# PATCH /chats/{chat_id} renames one conversation.
@router.patch(
    "/{chat_id}",
    response_model=ChatResponse,
)
async def rename_chat(
    chat_id: int,
    request: ChatUpdate,
    session: DatabaseSession,
) -> ChatResponse:
    # Load the existing conversation before changing it.
    chat = await chat_repository.get_by_id(
        session=session,
        chat_id=chat_id,
    )

    # Prevent updates to nonexistent records.
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found.",
        )

    # Normalise the new title.
    clean_title = request.title.strip()

    # Reject whitespace-only names.
    if not clean_title:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Chat title cannot be empty.",
        )

    # Persist the rename.
    updated_chat = await chat_repository.update_title(
        session=session,
        chat=chat,
        title=clean_title,
    )

    # Return the updated durable record.
    return ChatResponse.model_validate(updated_chat)


# DELETE /chats/{chat_id} permanently removes one conversation.
@router.delete(
    "/{chat_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_chat(
    chat_id: int,
    session: DatabaseSession,
) -> Response:
    # Load the conversation so deletion cannot silently ignore invalid IDs.
    chat = await chat_repository.get_by_id(
        session=session,
        chat_id=chat_id,
    )

    # Return 404 when the requested conversation does not exist.
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found.",
        )

    # Delete the durable conversation through the repository.
    await chat_repository.delete(
        session=session,
        chat=chat,
    )

    # A successful DELETE with status 204 has no JSON response body.
    return Response(status_code=status.HTTP_204_NO_CONTENT)
