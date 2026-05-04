from __future__ import annotations

import io
import logging
from dataclasses import dataclass
from typing import Iterable, Optional

from modules.team3_ocr.config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class BlobRef:
    container: str
    name: str


class BlobStorageClient:
    """
    Minimal Azure Blob Storage helper.

    This is intentionally small and used as an internal service layer so routes/providers
    don't need to know Azure SDK details.
    """

    def __init__(self):
        self._available = None
        self._container_client = None

    def is_available(self) -> bool:
        if self._available is not None:
            return self._available
        try:
            from azure.storage.blob import BlobServiceClient  # noqa: F401
        except Exception:
            self._available = False
            logger.warning(
                "azure-storage-blob is not installed; Blob Storage output syncing is disabled. "
                "Install it with: pip install azure-storage-blob"
            )
            return self._available

        container_name = settings.azure_blob_container_name or settings.azure_storage_container
        if not container_name:
            self._available = False
            logger.warning("Azure blob container is not configured (AZURE_BLOB_CONTAINER_NAME).")
            return self._available

        try:
            from azure.storage.blob import BlobServiceClient

            if settings.azure_storage_connection_string:
                service = BlobServiceClient.from_connection_string(settings.azure_storage_connection_string)
            else:
                if not settings.azure_storage_account_name or not settings.azure_storage_account_key:
                    self._available = False
                    logger.warning(
                        "Azure Storage credentials are not configured. "
                        "Set AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT_NAME/AZURE_STORAGE_ACCOUNT_KEY."
                    )
                    return self._available

                account_url = f"https://{settings.azure_storage_account_name}.blob.core.windows.net"
                service = BlobServiceClient(account_url=account_url, credential=settings.azure_storage_account_key)

            self._container_client = service.get_container_client(container_name)
            self._available = True
            return True
        except Exception as exc:
            self._available = False
            logger.warning(f"Failed to initialize Azure Blob client: {exc}")
            return False

    @property
    def container_name(self) -> str:
        return settings.azure_blob_container_name or settings.azure_storage_container

    def _get_container(self):
        if not self.is_available():
            raise RuntimeError("BlobStorageClient is not available/configured.")
        return self._container_client

    def list(self, prefix: str) -> Iterable[str]:
        container = self._get_container()
        for blob in container.list_blobs(name_starts_with=prefix):
            yield blob.name

    def upload_bytes(self, blob_name: str, data: bytes, *, content_type: Optional[str] = None) -> None:
        container = self._get_container()
        from azure.storage.blob import ContentSettings

        content_settings = ContentSettings(content_type=content_type) if content_type else None
        container.upload_blob(name=blob_name, data=io.BytesIO(data), overwrite=True, content_settings=content_settings)

    def download_bytes(self, blob_name: str) -> Optional[bytes]:
        container = self._get_container()
        try:
            downloader = container.download_blob(blob_name)
            return downloader.readall()
        except Exception:
            return None

    def delete(self, blob_name: str) -> None:
        container = self._get_container()
        try:
            container.delete_blob(blob_name)
        except Exception:
            return

