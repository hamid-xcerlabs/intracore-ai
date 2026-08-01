from pydantic import BaseModel, ConfigDict


class ChatModelOption(BaseModel):
    """One backend-approved model shown in the chat model selector."""

    model_config = ConfigDict(extra="forbid")

    name: str
    installed: bool
    selectable: bool
    family: str | None = None
    parameter_size: str | None = None
    quantization_level: str | None = None


class ChatModelListResponse(BaseModel):
    """Installed state plus the backend-controlled supported catalog."""

    model_config = ConfigDict(extra="forbid")

    default_model: str | None
    models: list[ChatModelOption]
