# datetime types the timestamps returned from the SQLite ORM model.
from datetime import datetime

# BaseModel defines validated API contracts.
# ConfigDict allows response models to read SQLAlchemy object attributes.
# Field adds validation constraints and API documentation.
from pydantic import BaseModel, ConfigDict, Field


# ChatCreate defines the optional input accepted when creating a conversation.
class ChatCreate(BaseModel):
    # A new conversation defaults to "New chat" when no title is supplied.
    title: str = Field(
        default="New chat",
        min_length=1,
        max_length=200,
    )


# ChatUpdate defines the data accepted when renaming an existing conversation.
class ChatUpdate(BaseModel):
    # Renaming requires a non-empty title.
    title: str = Field(
        min_length=1,
        max_length=200,
    )


# ChatResponse defines the stable JSON representation returned to the frontend.
class ChatResponse(BaseModel):
    # Allow Pydantic to build this response directly from SQLAlchemy attributes.
    model_config = ConfigDict(from_attributes=True)

    # Durable SQLite primary key used by routes and frontend selection state.
    id: int

    # Sidebar conversation title.
    title: str

    # Creation timestamp supplied by the database.
    created_at: datetime

    # Last-update timestamp supplied by the database.
    updated_at: datetime