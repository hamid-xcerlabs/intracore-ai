"""create memories

Revision ID: a14c0f1e2d3b
Revises: 5138dff79808
Create Date: 2026-08-04
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "a14c0f1e2d3b"
down_revision: str | Sequence[str] | None = "5138dff79808"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add explicit global memories without changing existing chat tables."""

    op.create_table(
        "memories",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column(
            "is_enabled",
            sa.Boolean(),
            server_default=sa.true(),
            nullable=False,
        ),
        sa.Column("source_chat_id", sa.Integer(), nullable=True),
        sa.Column("source_message_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "length(trim(content)) > 0",
            name="ck_memories_content_not_blank",
        ),
        sa.CheckConstraint(
            "kind IN ('fact', 'preference', 'instruction')",
            name="ck_memories_kind",
        ),
        sa.ForeignKeyConstraint(
            ["source_chat_id"],
            ["chats.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["source_message_id"],
            ["messages.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_memories_is_enabled",
        "memories",
        ["is_enabled"],
        unique=False,
    )
    op.create_index(
        "ix_memories_source_chat_id",
        "memories",
        ["source_chat_id"],
        unique=False,
    )
    op.create_index(
        "ix_memories_source_message_id",
        "memories",
        ["source_message_id"],
        unique=False,
    )


def downgrade() -> None:
    """Remove memory indexes before dropping the standalone memory table."""

    op.drop_index("ix_memories_source_message_id", table_name="memories")
    op.drop_index("ix_memories_source_chat_id", table_name="memories")
    op.drop_index("ix_memories_is_enabled", table_name="memories")
    op.drop_table("memories")
