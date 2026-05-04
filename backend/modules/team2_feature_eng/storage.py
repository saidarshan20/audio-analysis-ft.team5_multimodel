"""
storage.py - Intermediate Data Storage (Azure Blob → Local Fallback)

Handles persisting DataFrames and metadata for workflow sessions.
Primary: Azure Blob Storage (folder: "feature eng_intermediate data")
Fallback: Local disk (shared_workspace/feature_eng_intermediate_data/)
"""

import io
import os
import json
import logging

import pandas as pd

logger = logging.getLogger(__name__)

# ─── Constants ─────────────────────────────────────────────────────────────────
BLOB_FOLDER = "feature eng/feature eng intermediate data"
LOCAL_FALLBACK_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "shared_workspace", "feature_eng_intermediate_data"
)


# ═══════════════════════════════════════════════════════════════════════════════
# BLOB STORAGE HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def _get_blob_service():
    """Returns (BlobServiceClient, container_name) or (None, None) if unavailable."""
    try:
        connection_string = os.getenv("AZURE_CONNECTION_STRING")
        container_name = os.getenv("AZURE_CONTAINER_NAME")
        if not connection_string or not container_name:
            return None, None
        from azure.storage.blob import BlobServiceClient
        client = BlobServiceClient.from_connection_string(connection_string)
        return client, container_name
    except Exception as e:
        logger.warning(f"Azure Blob not available: {e}")
        return None, None


def _upload_blob(blob_name: str, data: bytes) -> bool:
    """Upload bytes to blob. Returns True on success."""
    client, container = _get_blob_service()
    if not client:
        return False
    try:
        blob_client = client.get_blob_client(container=container, blob=blob_name)
        blob_client.upload_blob(data, overwrite=True)
        return True
    except Exception as e:
        logger.warning(f"Blob upload failed for '{blob_name}': {e}")
        return False


def _download_blob(blob_name: str) -> bytes | None:
    """Download bytes from blob. Returns None on failure."""
    client, container = _get_blob_service()
    if not client:
        return None
    try:
        blob_client = client.get_blob_client(container=container, blob=blob_name)
        return blob_client.download_blob().readall()
    except Exception as e:
        logger.warning(f"Blob download failed for '{blob_name}': {e}")
        return None


def _delete_blob_folder(session_id: str) -> bool:
    """Delete all blobs under a session folder."""
    client, container = _get_blob_service()
    if not client:
        return False
    try:
        container_client = client.get_container_client(container)
        prefix = f"{BLOB_FOLDER}/{session_id}/"
        blobs = container_client.list_blobs(name_starts_with=prefix)
        for blob in blobs:
            container_client.delete_blob(blob.name)
        return True
    except Exception as e:
        logger.warning(f"Blob folder delete failed for '{session_id}': {e}")
        return False


# ═══════════════════════════════════════════════════════════════════════════════
# LOCAL STORAGE HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def _local_session_dir(session_id: str) -> str:
    path = os.path.join(LOCAL_FALLBACK_DIR, session_id)
    os.makedirs(path, exist_ok=True)
    return path


def _save_local(session_id: str, filename: str, data: bytes):
    filepath = os.path.join(_local_session_dir(session_id), filename)
    with open(filepath, "wb") as f:
        f.write(data)


def _load_local(session_id: str, filename: str) -> bytes | None:
    filepath = os.path.join(_local_session_dir(session_id), filename)
    if not os.path.exists(filepath):
        return None
    with open(filepath, "rb") as f:
        return f.read()


def _delete_local(session_id: str):
    import shutil
    path = os.path.join(LOCAL_FALLBACK_DIR, session_id)
    if os.path.exists(path):
        shutil.rmtree(path, ignore_errors=True)


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC API — Save / Load / Delete
# ═══════════════════════════════════════════════════════════════════════════════

def save_dataframe(session_id: str, name: str, df: pd.DataFrame):
    """
    Persist a DataFrame. Tries Azure Blob first, falls back to local.
    name: e.g. 'current_df' or 'original_df'
    """
    buf = io.BytesIO()
    df.to_parquet(buf, index=False, engine="pyarrow")
    data = buf.getvalue()

    blob_name = f"{BLOB_FOLDER}/{session_id}/{name}.parquet"
    if not _upload_blob(blob_name, data):
        _save_local(session_id, f"{name}.parquet", data)


def load_dataframe(session_id: str, name: str) -> pd.DataFrame | None:
    """Load a persisted DataFrame. Tries Blob first, then local."""
    blob_name = f"{BLOB_FOLDER}/{session_id}/{name}.parquet"
    data = _download_blob(blob_name)
    if data is None:
        data = _load_local(session_id, f"{name}.parquet")
    if data is None:
        return None
    return pd.read_parquet(io.BytesIO(data))


def save_metadata(session_id: str, metadata: dict):
    """Save session metadata (JSON-serializable dict)."""
    data = json.dumps(metadata, default=str).encode("utf-8")
    blob_name = f"{BLOB_FOLDER}/{session_id}/metadata.json"
    if not _upload_blob(blob_name, data):
        _save_local(session_id, "metadata.json", data)


def load_metadata(session_id: str) -> dict | None:
    """Load session metadata."""
    blob_name = f"{BLOB_FOLDER}/{session_id}/metadata.json"
    data = _download_blob(blob_name)
    if data is None:
        data = _load_local(session_id, "metadata.json")
    if data is None:
        return None
    return json.loads(data.decode("utf-8"))


def delete_session_storage(session_id: str):
    """Remove all persisted data for a session (both blob and local)."""
    _delete_blob_folder(session_id)
    _delete_local(session_id)
