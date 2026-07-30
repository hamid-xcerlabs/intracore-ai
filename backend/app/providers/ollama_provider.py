from typing import Any #Any ka matlab value kisi bhi type ki ho sakti hai.

import httpx           #httpx Python HTTP client hai.
from langchain_core.messages import HumanMessage
from langchain_ollama import ChatOllama

from app.core.config import get_settings   #Central configuration system se settings import ho rahi hain. Model hard-coded nahi hua.


settings = get_settings()


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
        self.chat_client = ChatOllama( #Yeh reusable LangChain model client create karta hai.
            model=self.chat_model, #Model .env configuration se aa raha hai.
            base_url=self.base_url, #LangChain ko batata hai Ollama kis address par running hai: http://127.0.0.1:11434
            temperature=0.7, #Temperature model response ki randomness control karti hai.
        )

    async def get_installed_models(self) -> list[str]:    #Yeh asynchronous function installed models ki list return karega.
        async with httpx.AsyncClient(timeout=10.0) as client: #Ek asynchronous HTTP client temporarily create hota hai.
            response = await client.get(f"{self.base_url}/api/tags") #Ollama ka /api/tags endpoint installed models ki list deta hai. http://127.0.0.1:11434/api/tags
            response.raise_for_status() # agr 200 return kre to contnue, Without this line, error response ko bhi normal successful JSON samjha ja sakta tha.

        data: dict[str, Any] = response.json() #Ollama ka JSON response Python dictionary mein convert hota hai.

        return [
            model["name"]
            for model in data.get("models", [])
            if "name" in model
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

        except httpx.ConnectError:
            return {
                "connected": False,
                "error": "Could not connect to Ollama.",
                "ollama_url": self.base_url,
            }

        except httpx.HTTPStatusError as exc:  #Yeh tab chalega jab FastAPI Ollama server se connection hi establish na kar sake.
            return {
                "connected": False,
                "error": f"Ollama returned HTTP {exc.response.status_code}.",
                "ollama_url": self.base_url,
            }
##Error handling
        except httpx.RequestError as exc:
            return {
                "connected": False,
                "error": f"Ollama request failed: {str(exc)}",
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