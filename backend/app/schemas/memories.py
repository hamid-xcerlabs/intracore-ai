from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


MemoryKind = Literal["fact", "preference", "instruction"]


def normalize_memory_content(value: str) -> str:
    """Trim user input once at the API boundary and reject blank memories."""

    normalized = value.strip()
    if not normalized:
        raise ValueError("Memory content cannot be empty.")
    return normalized


class MemoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(max_length=20_000)
    kind: MemoryKind
    is_enabled: bool = True
    source_chat_id: int | None = Field(default=None, gt=0)
    source_message_id: int | None = Field(default=None, gt=0)

    _normalize_content = field_validator("content")(normalize_memory_content)


class MemoryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str | None = Field(default=None, max_length=20_000)
    kind: MemoryKind | None = None
    is_enabled: bool | None = None
    source_chat_id: int | None = Field(default=None, gt=0)
    source_message_id: int | None = Field(default=None, gt=0)

    @field_validator("content")
    @classmethod
    def normalize_optional_content(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return normalize_memory_content(value)

    @model_validator(mode="after")
    def require_meaningful_update(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("At least one memory field must be provided.")

        # Content, kind, and enabled state are non-nullable database fields;
        # source identifiers alone may explicitly be cleared with null.
        for field_name in ("content", "kind", "is_enabled"):
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null.")
        return self


class MemoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    content: str
    kind: MemoryKind
    is_enabled: bool
    source_chat_id: int | None
    source_message_id: int | None
    created_at: datetime
    updated_at: datetime
