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

    # --- CORS (for run_local.py standalone testing) ---
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]

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
