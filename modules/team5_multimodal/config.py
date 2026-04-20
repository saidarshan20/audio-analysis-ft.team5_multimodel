"""
config.py  –  Team 5 local configuration, loaded from root .env.
"""

import os
from functools import lru_cache

from pydantic_settings import BaseSettings


class Team5Settings(BaseSettings):
    # --- API Keys ---
    groq_api_key: str = ""
    nvidia_api_key: str = ""
    
    hf_token: str = ""
    
    # --- Models ---
    groq_model: str = "llama-3.3-70b-versatile"
    groq_vision_model: str = "meta-llama/llama-4-scout-17b-16e-instruct"
    nvidia_model: str = "meta/llama-3.3-70b-instruct"

    # --- Image Analysis (Local Models) ---
    yolo_model: str = "yolov8n.pt"
    caption_model: str = "Salesforce/blip-image-captioning-base"
    embedding_model: str = "sentence-transformers/clip-ViT-B-32"

    # --- Azure AI Vision (Optional Defaults) ---
    azure_vision_key: str = ""
    azure_vision_endpoint: str = ""
    
    # --- Audio Tooling (Optional, needed for pydub) ---
    ffmpeg_path: str = ""
    ffprobe_path: str = ""

    # --- data.gov.in Open Data Catalog ---
    data_gov_api_key: str = ""

    # --- Azure OpenAI (office laptop) ---
    # When all three are set, Azure OpenAI is used instead of Groq/NVIDIA.
    azure_openai_key: str = ""
    azure_openai_endpoint: str = ""            # https://<resource>.openai.azure.com/
    azure_openai_deployment_name: str = ""     # e.g. "gpt-4o"
    azure_openai_model_name: str = "gpt-4o"   # display/fallback name
    azure_openai_api_version: str = "2024-02-01"
    azure_openai_embeddings_deployment_name: str = ""
    azure_openai_embeddings_model_name: str = ""

    # --- Azure Storage (office laptop) ---
    azure_storage_account_name: str = ""
    azure_storage_account_key: str = ""
    azure_blob_container_name: str = ""

    # --- Azure Document Intelligence (office laptop) ---
    azure_document_intelligence_endpoint: str = ""
    azure_document_intelligence_key: str = ""

    # --- App Ports (override in .env to avoid clashes on shared remote desktops) ---
    backend_port: int = 8742
    frontend_port: int = 3652

    # --- CORS (for run_local.py standalone testing) ---
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173", "http://localhost:3652"]

    model_config = {
        "env_file": os.path.join(
            os.path.dirname(__file__), "..", "..", ".env"
        ),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


@lru_cache
def get_settings() -> Team5Settings:
    settings = Team5Settings()
    if settings.hf_token:
        os.environ["HF_TOKEN"] = settings.hf_token
    # Make ffmpeg paths visible to libraries that read only process env vars
    if settings.ffmpeg_path:
        os.environ["FFMPEG_PATH"] = settings.ffmpeg_path
    if settings.ffprobe_path:
        os.environ["FFPROBE_PATH"] = settings.ffprobe_path
    return settings


def get_llm_client():
    """
    Returns (client, model_name) for the best available LLM backend.

    Priority: Azure OpenAI → NVIDIA NIM → Groq

    This single function replaces all per-endpoint if/else LLM blocks.
    Works on both the personal laptop (Groq/NVIDIA keys in .env) and the
    office laptop (AZURE_OPENAI_* keys in .env) without code changes.
    """
    from openai import AsyncOpenAI, AsyncAzureOpenAI  # local import keeps startup fast
    s = get_settings()

    # 1. Azure OpenAI — requires all three keys to be set
    if s.azure_openai_key and s.azure_openai_endpoint and s.azure_openai_deployment_name:
        client = AsyncAzureOpenAI(
            azure_endpoint=s.azure_openai_endpoint,
            api_key=s.azure_openai_key,
            api_version=s.azure_openai_api_version,
        )
        return client, s.azure_openai_deployment_name

    # 2. NVIDIA NIM
    if s.nvidia_api_key:
        return (
            AsyncOpenAI(base_url="https://integrate.api.nvidia.com/v1", api_key=s.nvidia_api_key),
            s.nvidia_model,
        )

    # 3. Groq (default / personal laptop)
    return (
        AsyncOpenAI(base_url="https://api.groq.com/openai/v1", api_key=s.groq_api_key),
        s.groq_model,
    )
