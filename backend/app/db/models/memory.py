from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Memory(Base):
    """One explicit, user-controlled memory available across conversations."""

    __tablename__ = "memories"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('fact', 'preference', 'instruction')",
            name="ck_memories_kind",
        ),
        CheckConstraint(
            "length(trim(content)) > 0",
            name="ck_memories_content_not_blank",
        ),
        # Enabled lookups happen on every generation request, while source
        # indexes support provenance inspection without scanning the table.
        Index("ix_memories_is_enabled", "is_enabled"),
        Index("ix_memories_source_chat_id", "source_chat_id"),
        Index("ix_memories_source_message_id", "source_message_id"),
    )

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    is_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=true(),
    )
    source_chat_id: Mapped[int | None] = mapped_column(
        ForeignKey("chats.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_message_id: Mapped[int | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
