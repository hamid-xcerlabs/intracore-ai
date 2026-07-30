# APIRouter allows this file to define related HTTP endpoints separately
# from the main FastAPI application entry point.
from fastapi import APIRouter
# Import the database connectivity diagnostic from the database layer.
from app.db.session import check_database_connection

# The central settings object provides application and model configuration
# without hard-coding values inside this route module.
from app.core.config import get_settings

# The shared Ollama provider performs the actual communication with the
# separately running local Ollama service.
from app.providers.ollama_provider import ollama_provider


# Load the cached application configuration.
# get_settings() returns the same settings object across the backend.
settings = get_settings()


# Create a router dedicated to health and diagnostic endpoints.
# The "Health" tag groups these routes inside FastAPI's /docs interface.
router = APIRouter(
    prefix="/health",
    tags=["Health"],
)


# GET /health checks only whether the FastAPI application is running.
@router.get("")
async def health_check() -> dict[str, str]:
    # Return basic backend and configured-model information as JSON.
    return {
        "status": "ok",
        "service": settings.app_name,
        "chat_model": settings.ollama_chat_model,
        "embedding_model": settings.ollama_embedding_model,
    }


# GET /health/ollama checks the separate local Ollama runtime.
@router.get("/ollama")
async def ollama_health_check() -> dict[str, object]:
    # Delegate Ollama-specific diagnostics to the provider layer.
    # The HTTP route should not contain Ollama communication logic itself.
    return await ollama_provider.check_connection()

# GET /health/database checks whether SQLAlchemy can reach the configured
# local SQLite database and execute a minimal query.

# health.py
#    ↓ calls
# db/session.py
#    ↓ uses
# config.py
#    ↓ reads
# .env
#    ↓ points to
# data/intracore.db

@router.get("/database")
async def database_health_check() -> dict[str, object]:
    # Delegate database-specific work to app/db/session.py.
    # The API route only exposes the result over HTTP.
    return await check_database_connection()