from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class BlobPaths:
    """
    Centralizes blob prefix conventions for the `aikosh-v2` container.

    Azure Blob Storage uses virtual folders; these are just blob name prefixes.
    """

    # "uploads" now contains the datasets tree (raw + processed)
    uploads_prefix: str = "ocr-workspace/uploads/"
    sessions_prefix: str = "ocr-workspace/sessions/"
    search_index_prefix: str = "ocr-workspace/search-index/"
    datasets_raw_prefix: str = "ocr-workspace/uploads/datasets/raw/"
    datasets_processed_prefix: str = "ocr-workspace/uploads/datasets/processed/"

    # Data Harvester dataset persistence
    harvester_raw_prefix: str = "ocr-workspace/uploads/data_harvester/raw_data_harvester/raw/"
    harvester_processed_prefix: str = "ocr-workspace/uploads/data_harvester/processed_data_harvester/processed/"

    embeddings_raw_prefix: str = "embeddings/datasets/raw/"
    embeddings_processed_prefix: str = "embeddings/datasets/processed/"

    def upload_blob_name(self, filename: str) -> str:
        # Store original uploaded files under uploads/datasets/raw/
        return f"{self.datasets_raw_prefix}{filename}"

    def session_blob_name(self, session_name: str, session_id: str) -> str:
        return f"{self.sessions_prefix}{session_name}/{session_id}.json"

    def viz_blob_name(self, image_name: str) -> str:
        return f"{self.datasets_processed_prefix}visualizations/{image_name}"

    def processed_doc_prefix(self, doc_id: str) -> str:
        return f"{self.datasets_processed_prefix}{doc_id}/"

    def processed_doc_json(self, doc_id: str) -> str:
        return f"{self.processed_doc_prefix(doc_id)}ocr_result.json"

    def processed_doc_text(self, doc_id: str) -> str:
        return f"{self.processed_doc_prefix(doc_id)}full_text.txt"

    def harvester_raw_blob_name(self, doc_id: str, filename: str) -> str:
        return f"{self.harvester_raw_prefix}{doc_id}/{filename}"

    def harvester_processed_blob_name(self, doc_id: str, filename: str) -> str:
        return f"{self.harvester_processed_prefix}{doc_id}/{filename}"

    def local_search_index_dir(self) -> Path:
        return Path("./data/search_index")
