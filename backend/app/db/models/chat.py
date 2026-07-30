# Postponed annotation evaluation allows relationship types such as
# list["Message"] without importing Message at runtime and causing cycles.
from __future__ import annotations

# datetime is used in Python type annotations for timestamp columns.
from datetime import datetime

# TYPE_CHECKING enables editor-only imports without runtime circular imports.
from typing import TYPE_CHECKING

# SQLAlchemy column types and SQL functions define the chats table fields.
from sqlalchemy import DateTime, String, func

# Mapped and mapped_column define typed ORM columns.
# relationship defines the one-chat-to-many-messages association.
from sqlalchemy.orm import Mapped, mapped_column, relationship

# All ORM models inherit from IntraCore's shared declarative Base.
from app.db.base import Base


# Import Message only for static analysis.
# At runtime, SQLAlchemy resolves the "Message" relationship by name.
if TYPE_CHECKING:
    from app.db.models.message import Message


# Chat represents one persistent conversation visible in the future sidebar.
class Chat(Base):
    # Explicit table name used inside SQLite and Alembic migrations.
    __tablename__ = "chats"

    # Integer primary keys are efficient and sufficient for the local V1.
    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
    )

    # The title identifies the conversation in the frontend sidebar.
    # A default is provided until automatic title generation is added.
    title: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        default="New chat",
    )

    # Creation time records when the conversation was first created.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # Updated time will change when ORM operations modify the conversation.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # A chat owns multiple ordered messages.
    # delete-orphan ensures messages cannot remain without their parent chat.
    # passive_deletes lets SQLite's ON DELETE CASCADE handle database deletion.
    messages: Mapped[list["Message"]] = relationship(
        back_populates="chat",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Message.sequence_number",
    )