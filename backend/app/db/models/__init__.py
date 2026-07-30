# Import Chat so its table is registered inside Base.metadata.
from app.db.models.chat import Chat

# Import Message so its table and Chat relationship are also registered.
from app.db.models.message import Message


# Explicit exports make model discovery clear to Alembic and other modules.
__all__ = [
    "Chat",
    "Message",
]