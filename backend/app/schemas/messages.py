# datetime types the creation timestamp returned for durable messages.
from datetime import datetime

# Literal restricts response roles to values supported by the database model.
from typing import Literal

# BaseModel defines the public API contract.
# ConfigDict allows validation directly from SQLAlchemy model attributes.
from pydantic import BaseModel, ConfigDict, Field


# MessageCreate accepts only user-authored message content from API clients.
class MessageCreate(BaseModel):
    # Reject undeclared fields such as a client-supplied role or model name.
    model_config = ConfigDict(extra="forbid")

    # The route performs additional trimming and whitespace-only validation.
    content: str = Field(
        min_length=1,
        description="The user message to save in the selected conversation.",
    )


# MessageResponse is the stable JSON representation of one durable message.
class MessageResponse(BaseModel):
    # Read response fields directly from a Message ORM object.
    model_config = ConfigDict(from_attributes=True)

    # Durable local message identifier.
    id: int

    # Parent conversation identifier.
    chat_id: int

    # Message producer role constrained to the database-supported values.
    role: Literal["user", "assistant", "system", "tool"]

    # Complete stored message text.
    content: str

    # Stable position of the message inside its conversation.
    sequence_number: int

    # Assistant messages may identify the model that generated them.
    model_name: str | None

    # Database-generated creation timestamp.
    created_at: datetime


# DurableGenerationResponse returns both records created by one complete turn.
class DurableGenerationResponse(BaseModel):
    # The user record is committed before model generation begins.
    user_message: MessageResponse

    # The assistant record exists only after successful generation.
    assistant_message: MessageResponse
