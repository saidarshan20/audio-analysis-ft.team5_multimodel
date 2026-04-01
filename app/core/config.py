from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # --- Azure OpenAI ---
    azure_openai_endpoint: str = ""
    azure_openai_api_key: str = ""
    azure_openai_api_version: str = "2024-12-01-preview"
    azure_openai_deployment: str = "gpt-4o"

    # --- Azure Document Intelligence ---
    azure_doc_intelligence_endpoint: str = ""
    azure_doc_intelligence_key: str = ""

    # --- CORS ---
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
