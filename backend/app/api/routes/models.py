from fastapi import APIRouter, HTTPException, status

from app.providers.ollama_provider import (
    OllamaUnavailableError,
    ollama_provider,
)
from app.schemas.models import ChatModelListResponse, ChatModelOption


router = APIRouter(
    prefix="/models",
    tags=["Models"],
)


@router.get("", response_model=ChatModelListResponse)
async def list_chat_models() -> ChatModelListResponse:
    """Return safe chat choices without exposing raw Ollama responses."""

    try:
        models = await ollama_provider.list_chat_models()
        default_model = ollama_provider.default_chat_model(models)
    except OllamaUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not connect to the local Ollama runtime.",
        ) from exc

    return ChatModelListResponse(
        default_model=default_model,
        models=[ChatModelOption(**model) for model in models],
    )
