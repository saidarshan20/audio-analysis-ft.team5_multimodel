"""
Application configuration — loaded from environment variables.
Swap providers by changing OCR_PROVIDER, NLP_PROVIDER, etc. in .env
"""

from pydantic_settings import BaseSettings
from pydantic import Field, field_validator
from typing import Optional
from pathlib import Path


class Settings(BaseSettings):
    """Central configuration for the OCR & Text Analytics module."""

    # ---- App ----
    app_name: str = "AI Sphere - OCR & Text Analytics"
    app_env: str = "development"
    debug: bool = True
    host: str = "0.0.0.0"
    port: int = 8000
    api_prefix: str = "/api/v1"
    expose_detailed_endpoints: bool = True

    # ---- Provider Selection ----
    ocr_provider: str = Field(default="local", description="'local' or 'azure'")
    nlp_provider: str = Field(default="local", description="'local' or 'azure'")
    search_provider: str = Field(default="local", description="'local' or 'azure'")
    storage_provider: str = Field(default="local", description="'local' or 'azure'")

    # ---- Auth (pluggable — disabled by default) ----
    auth_enabled: bool = False
    auth_secret_key: Optional[str] = None
    auth_algorithm: str = "HS256"

    # ---- Database ----
    database_url: str = "sqlite+aiosqlite:///./modules/team3_ocr/data/team3_ocr.db"

    # ---- File Storage (Shared Workspace) ----
    upload_dir: str = "./shared_workspace/1_raw_uploads"
    output_dir: str = "./shared_workspace/2_processed_data"
    sessions_dir: str = "./shared_workspace/3_sessions"
    max_file_size_mb: int = 50

    # ---- Local OCR ----
    tesseract_cmd: str = "tesseract"

    # ---- spaCy ----
    spacy_models: str = "en_core_web_sm"

    # ---- Azure Document Intelligence ----
    azure_document_intelligence_endpoint: Optional[str] = None
    azure_document_intelligence_key: Optional[str] = None

    # ---- Azure OpenAI ----
    azure_openai_endpoint: Optional[str] = None
    azure_openai_key: Optional[str] = None
    azure_openai_deployment: Optional[str] = None
    azure_openai_api_version: Optional[str] = None
    azure_openai_model_name: Optional[str] = None
    azure_openai_embeddings_deployment_name: Optional[str] = None
    azure_openai_embeddings_model_name: Optional[str] = None

    # ---- Azure Blob Storage ----
    azure_storage_connection_string: Optional[str] = None
    azure_storage_account_name: Optional[str] = None
    azure_storage_account_key: Optional[str] = None
    azure_storage_container: str = "ocr-documents"
    azure_blob_container_name: Optional[str] = None

    # ---- Azure Search ----
    azure_search_endpoint: Optional[str] = None
    azure_search_key: Optional[str] = None

    # ---- External Dataset API ----
    dataset_api_base_url: Optional[str] = None
    dataset_api_key: Optional[str] = None

    @field_validator("debug", mode="before")
    @classmethod
    def normalize_debug(cls, value):
        """Accept common environment-style debug strings such as 'release'."""
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "yes", "on", "debug", "dev", "development"}:
                return True
            if normalized in {"0", "false", "no", "off", "release", "prod", "production"}:
                return False
        return value

    @property
    def is_azure(self) -> bool:
        """Check if any provider is set to azure."""
        return any(p == "azure" for p in [
            self.ocr_provider,
            self.nlp_provider,
            self.search_provider,
            self.storage_provider,
        ])

    @property
    def max_file_size_bytes(self) -> int:
        return self.max_file_size_mb * 1024 * 1024

    def ensure_directories(self):
        """Create required directories if they don't exist."""
        Path(self.upload_dir).mkdir(parents=True, exist_ok=True)
        Path(self.output_dir).mkdir(parents=True, exist_ok=True)
        Path(self.sessions_dir).mkdir(parents=True, exist_ok=True)
        # Ensure database directory exists
        db_path = self.database_url.replace("sqlite+aiosqlite:///", "")
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

        # If using Azure Blob Storage, materialize the expected "folders" by uploading `.keep` blobs.
        # Azure folders are virtual; having a placeholder blob ensures they always appear in the Portal/UI.
        if self.storage_provider == "azure":
            try:
                from modules.team3_ocr.storage import BlobStorageClient, BlobPaths

                blob = BlobStorageClient()
                if blob.is_available():
                    paths = BlobPaths()
                    keep_blobs = [
                        f"{paths.uploads_prefix}.keep",
                        f"{paths.datasets_raw_prefix}.keep",
                        f"{paths.datasets_processed_prefix}.keep",
                        f"{paths.harvester_raw_prefix}.keep",
                        f"{paths.harvester_processed_prefix}.keep",
                        f"{paths.sessions_prefix}.keep",
                        f"{paths.search_index_prefix}.keep",
                        f"{paths.embeddings_raw_prefix}.keep",
                        f"{paths.embeddings_processed_prefix}.keep",
                    ]
                    for name in keep_blobs:
                        blob.upload_bytes(name, b"", content_type="text/plain")
            except Exception:
                # Best-effort only; don't block app startup on blob UI placeholders.
                pass

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": False,
        "extra": "ignore", #add this
    }


# Singleton instance
settings = Settings()
