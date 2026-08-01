import asyncio
from typing import Any #Any ka matlab value kisi bhi type ki ho sakti hai.

import httpx           #httpx Python HTTP client hai.
from langchain_core.messages import HumanMessage
from langchain_ollama import ChatOllama

from app.core.config import get_settings   #Central configuration system se settings import ho rahi hain. Model hard-coded nahi hua.


settings = get_settings()


# Product-approved local chat models remain backend-controlled. Locally
# installed custom models are added only when Ollama reports completion
# capability; embedding-only models never enter the chat selector.
SUPPORTED_CHAT_MODEL_CATALOG = (
    "qwen2.5:3b",
    "qwen3:4b",
    "llama3.2:3b",
    "gemma3:4b",
)


class OllamaUnavailableError(Exception):
    """Hide local runtime transport failures behind a stable boundary."""


class OllamaModelUnavailableError(Exception):
    """The requested model is missing or is not suitable for chat."""


class OllamaProvider:                         #Yeh Ollama-related functionality ka blueprint hai.
    def __init__(self) -> None:               #__init__ class ka constructor hota hai.
        self.base_url = settings.ollama_base_url  #Ollama ka address object ke andar save ho gaya:
        self.chat_model = settings.ollama_chat_model  #Current configured chat model save hua.
        self.embedding_model = settings.ollama_embedding_model  #Current configured embedding model save hua.
#ChatOllama LangChain aur Ollama ke darmiyan adapter hai.
# Iska faida future mein milega jab hum:

# System messages
# Human messages
# AI messages
# Streaming
# LangGraph
# Structured output
# Prompt templates
        self.chat_client = self.create_chat_client(self.chat_model)

    def create_chat_client(self, model_name: str) -> ChatOllama:
        """Create an immutable request-specific client without global races."""

        return ChatOllama(
            model=model_name,
            base_url=self.base_url,
            temperature=0.7,
        )

    async def _get_installed_model_records(self) -> list[dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                response.raise_for_status()
            data: dict[str, Any] = response.json()
        except (httpx.RequestError, httpx.HTTPStatusError, ValueError) as exc:
            raise OllamaUnavailableError from exc

        return [
            model
            for model in data.get("models", [])
            if isinstance(model, dict) and isinstance(model.get("name"), str)
        ]

    async def _get_model_capabilities(self, model_name: str) -> set[str]:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f"{self.base_url}/api/show",
                    json={"model": model_name},
                )
                response.raise_for_status()
            data: dict[str, Any] = response.json()
        except (httpx.RequestError, httpx.HTTPStatusError, ValueError):
            return set()

        capabilities = data.get("capabilities", [])
        return {
            capability
            for capability in capabilities
            if isinstance(capability, str)
        }

    @staticmethod
    def _model_option(
        name: str,
        installed: bool,
        selectable: bool,
        record: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        details = record.get("details", {}) if record else {}
        if not isinstance(details, dict):
            details = {}

        return {
            "name": name,
            "installed": installed,
            "selectable": selectable,
            "family": details.get("family"),
            "parameter_size": details.get("parameter_size"),
            "quantization_level": details.get("quantization_level"),
        }

    async def list_chat_models(self) -> list[dict[str, Any]]:
        records = await self._get_installed_model_records()
        installed_by_name = {
            record["name"].casefold(): record
            for record in records
        }
        supported_names = {
            name.casefold() for name in SUPPORTED_CHAT_MODEL_CATALOG
        }
        options: list[dict[str, Any]] = []

        # Preserve deliberate product ordering for the supported catalog.
        for catalog_name in SUPPORTED_CHAT_MODEL_CATALOG:
            record = installed_by_name.get(catalog_name.casefold())
            actual_name = record["name"] if record else catalog_name
            options.append(
                self._model_option(
                    name=actual_name,
                    installed=record is not None,
                    selectable=record is not None,
                    record=record,
                )
            )

        custom_records = [
            record
            for record in records
            if record["name"].casefold() not in supported_names
        ]
        capability_results = await asyncio.gather(
            *(
                self._get_model_capabilities(record["name"])
                for record in custom_records
            )
        )

        for record, capabilities in sorted(
            zip(custom_records, capability_results, strict=True),
            key=lambda item: item[0]["name"].casefold(),
        ):
            if "completion" not in capabilities:
                continue

            options.append(
                self._model_option(
                    name=record["name"],
                    installed=True,
                    selectable=True,
                    record=record,
                )
            )

        return options

    def default_chat_model(
        self,
        options: list[dict[str, Any]],
    ) -> str | None:
        selectable = {
            option["name"].casefold(): option["name"]
            for option in options
            if option["selectable"]
        }
        return selectable.get(self.chat_model.casefold()) or next(
            iter(selectable.values()),
            None,
        )

    async def resolve_chat_model(self, requested: str | None) -> str:
        options = await self.list_chat_models()
        selectable = {
            option["name"].casefold(): option["name"]
            for option in options
            if option["selectable"]
        }

        if requested is not None:
            resolved = selectable.get(requested.strip().casefold())
            if resolved is None:
                raise OllamaModelUnavailableError
            return resolved

        default_model = self.default_chat_model(options)
        if default_model is None:
            raise OllamaModelUnavailableError

        return default_model

    async def get_installed_models(self) -> list[str]:    #Yeh asynchronous function installed models ki list return karega.
        return [
            model["name"]
            for model in await self._get_installed_model_records()
        ]

    async def check_connection(self) -> dict[str, object]: #Yeh function complete diagnostic response banata hai.
        try:
            installed_models = await self.get_installed_models() #Pehle Ollama se installed models leta hai., Agar successful hua, iska matlab connection working hai.

            return {
                "connected": True,
                "ollama_url": self.base_url,
                "chat_model": self.chat_model,
                "chat_model_installed": self.chat_model in installed_models,
                "embedding_model": self.embedding_model,
                "embedding_model_installed": (
                    self.embedding_model in installed_models
                ),
                "installed_models": installed_models,
            }

        except OllamaUnavailableError:
            return {
                "connected": False,
                "error": "Could not connect to Ollama.",
                "ollama_url": self.base_url,
            }

    async def generate_chat_response(self, message: str) -> str:
        result = await self.chat_client.ainvoke(
            [
                HumanMessage(content=message), #LangChain raw text ko chat-role object mein convert karta hai.
            ]
        )

        if isinstance(result.content, str):
            return result.content

        return str(result.content)


ollama_provider = OllamaProvider()



# Browser
#    ↓ GET /health/ollama
# FastAPI route
#    ↓
# OllamaProvider.check_connection()
#    ↓
# GET localhost:11434/api/tags
#    ↓
# Installed models
#    ↓
# JSON response to browser
