"""
config.py  –  Team 5 local configuration, loaded from root .env.
"""

import os
from functools import lru_cache

from pydantic_settings import BaseSettings


class Team5Settings(BaseSettings):
    # --- Groq ---
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    # --- Image Analysis (Local Models) ---
    yolo_model: str = "yolov8n.pt"
    caption_model: str = "Salesforce/blip-image-captioning-base"
    embedding_model: str = "sentence-transformers/clip-ViT-B-32"

    # --- Azure AI Vision (Optional Defaults) ---
    azure_vision_key: str = ""
    azure_vision_endpoint: str = ""

    # --- CORS (for run_local.py standalone testing) ---
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    model_config = {
        "env_file": os.path.join(
            os.path.dirname(__file__), "..", "..", ".env"
        ),
        "env_file_encoding": "utf-8",
    }


@lru_cache
def get_settings() -> Team5Settings:
    return Team5Settings()
