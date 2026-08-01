from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict
#Without configuration system model = "deepseek-r1:1.5b" then this name may in diff files needs to be update after changing the model

class Settings(BaseSettings): #BaseSettings .env ko read karke values Python object mein convert karta hai.
    app_name: str = "IntraCore AI API"
    app_version: str = "0.1.0"

    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_chat_model: str = "deepseek-r1:1.5b"
    ollama_embedding_model: str = "nomic-embed-text"
    # "auto" preserves normal model behavior without forcing an unsupported
    # reasoning flag. Enabled/disabled are explicit backend-controlled modes.
    ollama_reasoning_mode: Literal[
        "auto",
        "enabled",
        "disabled",
    ] = "auto"
    # SQLAlchemy database connection URL.
    # The default points to a local SQLite file inside backend/data.
    database_url: str = "sqlite+aiosqlite:///./data/intracore.db"
    
    # Browser origin allowed to call the local FastAPI backend during development.
    frontend_origin: str = "http://localhost:3000"
    
    model_config = SettingsConfigDict( #env_file=".env" Pydantic ko batata hai:Configuration backend folder ki .env file se read karo.
        env_file=".env", #File kis text encoding mein read hogi.
        env_file_encoding="utf-8",
        extra="ignore", #Agar .env mein future mein koi additional setting ho jo current Settings class mein define nahi, application immediately crash nahi karegi.
    )


@lru_cache #why used: Without cache, jab bhi get_settings() call hota, .env dobara read ho sakti thi aur new settings object create hota.
def get_settings() -> Settings:
    return Settings()
