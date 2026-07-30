# Postponed annotation evaluation prevents runtime circular type imports.
from __future__ import annotations

# datetime is used by the message timestamp column.
from datetime import datetime

# TYPE_CHECKING supports editor typing without importing Chat at runtime.
from typing import TYPE_CHECKING

# CheckConstraint restricts message roles to supported internal roles.
# ForeignKey connects each message to one parent chat.
# Indexes and column types define durable message storage.
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)

# Mapped and mapped_column define typed database fields.
# relationship creates the ORM connection back to Chat.
from sqlalchemy.orm import Mapped, mapped_column, relationship

# All persistent models share the same SQLAlchemy metadata.
from app.db.base import Base


# Chat is imported only for type checking.
if TYPE_CHECKING:
    from app.db.models.chat import Chat


# Message represents one user, assistant, system, or future tool message.
class Message(Base):
    # Explicit SQLite table name.
    __tablename__ = "messages"

    # Database-level rules belonging to the complete messages table.
    __table_args__ = (
        # Sequence numbers must be unique inside each conversation.
        UniqueConstraint(
            "chat_id",
            "sequence_number",
            name="uq_messages_chat_sequence",
        ),

        # Restrict roles while keeping future system/tool support possible.
        CheckConstraint(
            "role IN ('user', 'assistant', 'system', 'tool')",
            name="ck_messages_role",
        ),

        # Speed up loading messages belonging to a particular chat.
        Index(
            "ix_messages_chat_id",
            "chat_id",
        ),
    )

    # Unique local identifier for the message.
    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
    )

    # Foreign key identifies which conversation owns this message.
    # ON DELETE CASCADE removes messages when their chat is deleted.
    chat_id: Mapped[int] = mapped_column(
        ForeignKey(
            "chats.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    # Role identifies who produced the message.
    role: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )

    # Text stores the complete durable message content.
    content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # Sequence number preserves exact conversation ordering independently
    # from timestamps, which can occasionally be identical.
    sequence_number: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    # Assistant messages may record which configurable model generated them.
    # User messages can leave this field empty.
    model_name: Mapped[str | None] = mapped_column(
        String(200),
        nullable=True,
    )

    # Creation timestamp records when the message entered durable history.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # ORM relationship provides message.chat in Python code.
    chat: Mapped["Chat"] = relationship(
        back_populates="messages",
    )