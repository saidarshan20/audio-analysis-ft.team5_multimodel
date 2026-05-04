# """
# Azure Blob Storage implementation for Team 1 AutoML assets.
# """

# import json
# import logging
# import os
# from pathlib import Path

# from .config import (
#     AZURE_STORAGE_CONNECTION_STRING,
#     AZURE_BLOB_CONTAINER_NAME,
#     AZURE_STORAGE_AUTOML_PREFIX,
#     RAW_UPLOADS_DIR,
#     MODELS_DIR,
#     PROCESSED_DATA_DIR,
# )

# logger = logging.getLogger(__name__)

# _blob_service = None


# def _automl_prefix() -> str:
#     return (AZURE_STORAGE_AUTOML_PREFIX or "").strip().strip("/")


# def _blob_path(*segments: str) -> str:
#     base = _automl_prefix()
#     rest = [s.strip("/").replace("\\", "/") for s in segments if s is not None and s != ""]
#     parts = ([base] if base else []) + rest
#     return "/".join(parts)


# def _get_blob_service():
#     global _blob_service
#     if _blob_service is None:
#         try:
#             from azure.core.exceptions import ResourceExistsError
#             from azure.storage.blob import BlobServiceClient

#             raw_conn = (os.getenv("AZURE_STORAGE_CONNECTION_STRING") or "").strip()
#             account_name = (os.getenv("AZURE_STORAGE_ACCOUNT_NAME") or "").strip()
#             account_key = (os.getenv("AZURE_STORAGE_ACCOUNT_KEY") or "").strip()
#             endpoint_suffix = (os.getenv("AZURE_STORAGE_ENDPOINT_SUFFIX") or "core.windows.net").strip()

#             if raw_conn:
#                 _blob_service = BlobServiceClient.from_connection_string(raw_conn)
#             elif account_name and account_key:
#                 account_url = f"https://{account_name}.blob.{endpoint_suffix}"
#                 _blob_service = BlobServiceClient(account_url=account_url, credential=account_key)
#             else:
#                 if not (AZURE_STORAGE_CONNECTION_STRING or "").strip():
#                     raise ValueError(
#                         "Azure storage not configured: set AZURE_STORAGE_CONNECTION_STRING, "
#                         "or set AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY in .env"
#                     )
#                 _blob_service = BlobServiceClient.from_connection_string(AZURE_STORAGE_CONNECTION_STRING)

#             container = _blob_service.get_container_client(AZURE_BLOB_CONTAINER_NAME)
#             try:
#                 container.create_container()
#             except ResourceExistsError:
#                 pass
#             logger.info(
#                 "Azure Blob Storage initialized: container=%s prefix=%s/",
#                 AZURE_BLOB_CONTAINER_NAME,
#                 _automl_prefix(),
#             )
#         except Exception as e:
#             logger.error("Azure Blob init failed: %s", e)
#             raise
#     return _blob_service


# class AzureStorage:
#     def save_dataset(self, dataset_id: str, filename: str, content: bytes) -> str:
#         blob_service = _get_blob_service()
#         blob_name = _blob_path("datasets", dataset_id, filename)
#         blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
#         blob_client.upload_blob(content, overwrite=True)

#         local_dir = RAW_UPLOADS_DIR / dataset_id
#         local_dir.mkdir(parents=True, exist_ok=True)
#         local_path = local_dir / filename
#         local_path.write_bytes(content)
#         return str(local_path)

#     def get_dataset_path(self, dataset_id: str, filename: str) -> str:
#         local_path = RAW_UPLOADS_DIR / dataset_id / filename
#         if local_path.exists():
#             return str(local_path)

#         blob_service = _get_blob_service()
#         blob_name = _blob_path("datasets", dataset_id, filename)
#         blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
#         data = blob_client.download_blob().readall()

#         local_path.parent.mkdir(parents=True, exist_ok=True)
#         local_path.write_bytes(data)
#         return str(local_path)

#     def delete_dataset(self, dataset_id: str, filename: str):
#         try:
#             blob_service = _get_blob_service()
#             blob_name = _blob_path("datasets", dataset_id, filename)
#             blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
#             blob_client.delete_blob()
#         except Exception as e:
#             logger.warning("Azure blob delete failed: %s", e)

#         import shutil
#         local_dir = RAW_UPLOADS_DIR / dataset_id
#         if local_dir.exists():
#             shutil.rmtree(local_dir)

#     def save_model(self, run_id: str, filename: str, content: bytes) -> str:
#         blob_service = _get_blob_service()
#         blob_name = _blob_path("models", run_id, filename)
#         blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
#         blob_client.upload_blob(content, overwrite=True)

#         local_dir = MODELS_DIR / run_id
#         local_dir.mkdir(parents=True, exist_ok=True)
#         local_path = local_dir / filename
#         local_path.write_bytes(content)
#         return str(local_path)

#     def list_datasets(self) -> list[str]:
#         try:
#             blob_service = _get_blob_service()
#             container_client = blob_service.get_container_client(AZURE_BLOB_CONTAINER_NAME)
#             prefix = _blob_path("datasets") + "/"
#             blobs = container_client.list_blobs(name_starts_with=prefix)
#             ids = set()
#             for blob in blobs:
#                 rel = blob.name[len(prefix):]
#                 if "/" in rel:
#                     ids.add(rel.split("/", 1)[0])
#             return list(ids)
#         except Exception:
#             return []

#     def save_training_result(self, run_id: str, result_dict: dict) -> str:
#         blob_service = _get_blob_service()
#         blob_name = _blob_path("results", "training", run_id, "result.json")
#         content = json.dumps(result_dict, indent=2, default=str)
#         blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
#         blob_client.upload_blob(content, overwrite=True)

#         local_dir = PROCESSED_DATA_DIR / run_id
#         local_dir.mkdir(parents=True, exist_ok=True)
#         local_path = local_dir / "training_result.json"
#         local_path.write_text(content)
#         logger.info("Training result persisted to Azure + local: %s", run_id)
#         return str(local_path)

#     def get_training_result(self, run_id: str) -> dict | None:
#         local_path = PROCESSED_DATA_DIR / run_id / "training_result.json"
#         if local_path.exists():
#             try:
#                 return json.loads(local_path.read_text())
#             except Exception:
#                 pass

#         try:
#             blob_service = _get_blob_service()
#             blob_name = _blob_path("results", "training", run_id, "result.json")
#             blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
#             data = blob_client.download_blob().readall()
#             result = json.loads(data)

#             local_path.parent.mkdir(parents=True, exist_ok=True)
#             local_path.write_text(data.decode("utf-8") if isinstance(data, bytes) else data)
#             logger.info("Training result fetched from Azure and cached: %s", run_id)
#             return result
#         except Exception as e:
#             logger.debug("No Azure training result for %s: %s", run_id, e)
#             return None

#     def save_clustering_result(self, run_id: str, result_dict: dict) -> str:
#         blob_service = _get_blob_service()
#         blob_name = _blob_path("results", "clustering", run_id, "result.json")
#         content = json.dumps(result_dict, indent=2, default=str)
#         blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
#         blob_client.upload_blob(content, overwrite=True)

#         local_dir = PROCESSED_DATA_DIR / run_id
#         local_dir.mkdir(parents=True, exist_ok=True)
#         local_path = local_dir / "clustering_result.json"
#         local_path.write_text(content)
#         logger.info("Clustering result persisted to Azure + local: %s", run_id)
#         return str(local_path)

#     def get_clustering_result(self, run_id: str) -> dict | None:
#         local_path = PROCESSED_DATA_DIR / run_id / "clustering_result.json"
#         if local_path.exists():
#             try:
#                 return json.loads(local_path.read_text())
#             except Exception:
#                 pass

#         try:
#             blob_service = _get_blob_service()
#             blob_name = _blob_path("results", "clustering", run_id, "result.json")
#             blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
#             data = blob_client.download_blob().readall()
#             result = json.loads(data)

#             local_path.parent.mkdir(parents=True, exist_ok=True)
#             local_path.write_text(data.decode("utf-8") if isinstance(data, bytes) else data)
#             return result
#         except Exception as e:
#             logger.debug("No Azure clustering result for %s: %s", run_id, e)
#             return None

#     def save_model_binary(self, run_id: str, filename: str, local_path: str) -> str:
#         try:
#             src = Path(local_path)
#             if src.exists():
#                 blob_service = _get_blob_service()
#                 blob_name = _blob_path("models", run_id, filename)
#                 blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
#                 with open(str(src), "rb") as f:
#                     blob_client.upload_blob(f, overwrite=True)
#                 logger.info("Model binary uploaded to Azure: %s", blob_name)
#             return local_path
#         except Exception as e:
#             logger.warning("Failed to upload model binary to Azure: %s", e)
#             return local_path

#     def get_model_binary(self, run_id: str, filename: str) -> str | None:
#         run_dir = MODELS_DIR / run_id
#         local_path = run_dir / filename
#         if local_path.exists():
#             return str(local_path)

#         if run_dir.exists():
#             for f in run_dir.iterdir():
#                 if f.is_file():
#                     return str(f)

#         try:
#             blob_service = _get_blob_service()
#             blob_name = _blob_path("models", run_id, filename)
#             blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
#             data = blob_client.download_blob().readall()

#             run_dir.mkdir(parents=True, exist_ok=True)
#             local_path.write_bytes(data)
#             logger.info("Model binary downloaded from Azure: %s", blob_name)
#             return str(local_path)
#         except Exception as e:
#             logger.debug("No Azure model binary for %s/%s: %s", run_id, filename, e)
#             return None

#     def list_training_runs(self) -> list[str]:
#         run_ids = set()
#         try:
#             blob_service = _get_blob_service()
#             container_client = blob_service.get_container_client(AZURE_BLOB_CONTAINER_NAME)
#             prefix = _blob_path("results", "training") + "/"
#             blobs = container_client.list_blobs(name_starts_with=prefix)
#             for blob in blobs:
#                 rel = blob.name[len(prefix):]
#                 if rel and "/" in rel:
#                     run_ids.add(rel.split("/", 1)[0])
#         except Exception:
#             pass

#         if PROCESSED_DATA_DIR.exists():
#             for d in PROCESSED_DATA_DIR.iterdir():
#                 if d.is_dir() and (d / "training_result.json").exists():
#                     run_ids.add(d.name)

#         return list(run_ids)

#     def delete_training_result(self, run_id: str):
#         try:
#             blob_service = _get_blob_service()
#             container_client = blob_service.get_container_client(AZURE_BLOB_CONTAINER_NAME)
#             for base in (
#                 _blob_path("results", "training", run_id) + "/",
#                 _blob_path("results", "clustering", run_id) + "/",
#             ):
#                 blobs = container_client.list_blobs(name_starts_with=base)
#                 for blob in blobs:
#                     container_client.delete_blob(blob.name)
#         except Exception as e:
#             logger.warning("Azure result cleanup failed for %s: %s", run_id, e)

#         import shutil
#         for base_dir in [PROCESSED_DATA_DIR, MODELS_DIR]:
#             target = base_dir / run_id
#             if target.exists():
#                 shutil.rmtree(target)
"""
Azure Blob Storage implementation for Team 1 AutoML assets.
"""

import json
import logging
import os
import threading
from pathlib import Path

from .config import (
    AZURE_STORAGE_CONNECTION_STRING,
    AZURE_BLOB_CONTAINER_NAME,
    AZURE_STORAGE_AUTOML_PREFIX,
    RAW_UPLOADS_DIR,
    MODELS_DIR,
    PROCESSED_DATA_DIR,
)

logger = logging.getLogger(__name__)

_blob_service = None
_AZURE_WRITE_TIMEOUT_SECS = float(os.getenv("AZURE_STORAGE_WRITE_TIMEOUT_SECS", "5"))


def _automl_prefix() -> str:
    return (AZURE_STORAGE_AUTOML_PREFIX or "").strip().strip("/")


def _blob_path(*segments: str) -> str:
    base = _automl_prefix()
    rest = [s.strip("/").replace("\\", "/") for s in segments if s is not None and s != ""]
    parts = ([base] if base else []) + rest
    return "/".join(parts)


def _get_blob_service():
    global _blob_service
    if _blob_service is None:
        try:
            from azure.core.exceptions import ResourceExistsError
            from azure.storage.blob import BlobServiceClient

            raw_conn = (os.getenv("AZURE_STORAGE_CONNECTION_STRING") or "").strip()
            account_name = (os.getenv("AZURE_STORAGE_ACCOUNT_NAME") or "").strip()
            account_key = (os.getenv("AZURE_STORAGE_ACCOUNT_KEY") or "").strip()
            endpoint_suffix = (os.getenv("AZURE_STORAGE_ENDPOINT_SUFFIX") or "core.windows.net").strip()

            if raw_conn:
                _blob_service = BlobServiceClient.from_connection_string(raw_conn)
            elif account_name and account_key:
                account_url = f"https://{account_name}.blob.{endpoint_suffix}"
                _blob_service = BlobServiceClient(account_url=account_url, credential=account_key)
            else:
                if not (AZURE_STORAGE_CONNECTION_STRING or "").strip():
                    raise ValueError(
                        "Azure storage not configured: set AZURE_STORAGE_CONNECTION_STRING, "
                        "or set AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY in .env"
                    )
                _blob_service = BlobServiceClient.from_connection_string(AZURE_STORAGE_CONNECTION_STRING)

            container = _blob_service.get_container_client(AZURE_BLOB_CONTAINER_NAME)
            try:
                container.create_container()
            except ResourceExistsError:
                pass
            logger.info(
                "Azure Blob Storage initialized: container=%s prefix=%s/",
                AZURE_BLOB_CONTAINER_NAME,
                _automl_prefix(),
            )
        except Exception as e:
            logger.error("Azure Blob init failed: %s", e)
            raise
    return _blob_service


def _run_with_timeout(fn, *args, **kwargs):
    result: dict[str, object] = {}

    def _target():
        try:
            result["value"] = fn(*args, **kwargs)
        except Exception as exc:
            result["error"] = exc

    thread = threading.Thread(target=_target, daemon=True)
    thread.start()
    thread.join(_AZURE_WRITE_TIMEOUT_SECS)
    if thread.is_alive():
        raise TimeoutError(f"Operation timed out after {_AZURE_WRITE_TIMEOUT_SECS} seconds")
    if "error" in result:
        raise result["error"]  # type: ignore[misc]
    return result.get("value")


class AzureStorage:
    def save_dataset(self, dataset_id: str, filename: str, content: bytes) -> str:
        local_dir = RAW_UPLOADS_DIR / dataset_id
        local_dir.mkdir(parents=True, exist_ok=True)
        local_path = local_dir / filename
        local_path.write_bytes(content)

        try:
            def _azure_upload():
                blob_service = _get_blob_service()
                blob_name = _blob_path("datasets", dataset_id, filename)
                blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
                blob_client.upload_blob(content, overwrite=True)

            _run_with_timeout(_azure_upload)
        except TimeoutError:
            logger.warning(
                "Azure dataset upload timed out after %ss; keeping local copy only for %s",
                _AZURE_WRITE_TIMEOUT_SECS,
                filename,
            )
        except Exception as e:
            logger.warning("Azure dataset upload failed; keeping local copy only for %s: %s", filename, e)

        return str(local_path)

    def get_dataset_path(self, dataset_id: str, filename: str) -> str:
        local_path = RAW_UPLOADS_DIR / dataset_id / filename
        if local_path.exists():
            return str(local_path)

        # Local file missing — try Azure download as fallback
        try:
            blob_service = _get_blob_service()
            blob_name = _blob_path("datasets", dataset_id, filename)
            blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
            data = blob_client.download_blob().readall()

            local_path.parent.mkdir(parents=True, exist_ok=True)
            local_path.write_bytes(data)
            logger.info("Dataset downloaded from Azure and cached locally: %s/%s", dataset_id, filename)
            return str(local_path)
        except Exception as e:
            logger.warning(
                "Dataset file not found locally and Azure download failed for %s/%s: %s",
                dataset_id, filename, e,
            )
            raise FileNotFoundError(
                f"Dataset file '{filename}' is not available locally and could not be "
                f"downloaded from Azure storage. Please re-upload the dataset."
            ) from e

    def delete_dataset(self, dataset_id: str, filename: str):
        import shutil

        local_dir = RAW_UPLOADS_DIR / dataset_id
        if local_dir.exists():
            shutil.rmtree(local_dir)

        try:
            def _azure_delete():
                blob_service = _get_blob_service()
                blob_name = _blob_path("datasets", dataset_id, filename)
                blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
                blob_client.delete_blob()

            _run_with_timeout(_azure_delete)
        except TimeoutError:
            logger.warning(
                "Azure dataset delete timed out after %ss; removed local copy only for %s",
                _AZURE_WRITE_TIMEOUT_SECS,
                filename,
            )
        except Exception as e:
            logger.warning("Azure blob delete failed for %s: %s", filename, e)

    def save_model(self, run_id: str, filename: str, content: bytes) -> str:
        blob_service = _get_blob_service()
        blob_name = _blob_path("models", run_id, filename)
        blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
        blob_client.upload_blob(content, overwrite=True)

        local_dir = MODELS_DIR / run_id
        local_dir.mkdir(parents=True, exist_ok=True)
        local_path = local_dir / filename
        local_path.write_bytes(content)
        return str(local_path)

    def list_datasets(self) -> list[str]:
        try:
            blob_service = _get_blob_service()
            container_client = blob_service.get_container_client(AZURE_BLOB_CONTAINER_NAME)
            prefix = _blob_path("datasets") + "/"
            blobs = container_client.list_blobs(name_starts_with=prefix)
            ids = set()
            for blob in blobs:
                rel = blob.name[len(prefix):]
                if "/" in rel:
                    ids.add(rel.split("/", 1)[0])
            return list(ids)
        except Exception:
            return []

    def save_training_result(self, run_id: str, result_dict: dict) -> str:
        content = json.dumps(result_dict, indent=2, default=str)

        # Always save locally first (guaranteed to work)
        local_dir = PROCESSED_DATA_DIR / run_id
        local_dir.mkdir(parents=True, exist_ok=True)
        local_path = local_dir / "training_result.json"
        local_path.write_text(content)
        logger.info("Training result saved locally: %s", run_id)

        # Best-effort Azure upload (non-blocking with timeout)
        try:
            def _azure_upload():
                blob_service = _get_blob_service()
                blob_name = _blob_path("results", "training", run_id, "result.json")
                blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
                blob_client.upload_blob(content, overwrite=True)

            _run_with_timeout(_azure_upload)
            logger.info("Training result persisted to Azure + local: %s", run_id)
        except TimeoutError:
            logger.warning(
                "Azure training result upload timed out after %ss; local copy saved for %s",
                _AZURE_WRITE_TIMEOUT_SECS, run_id,
            )
        except Exception as e:
            logger.warning("Azure training result upload failed for %s: %s (local copy saved)", run_id, e)

        return str(local_path)

    def get_training_result(self, run_id: str) -> dict | None:
        local_path = PROCESSED_DATA_DIR / run_id / "training_result.json"
        if local_path.exists():
            try:
                return json.loads(local_path.read_text())
            except Exception:
                pass

        try:
            blob_service = _get_blob_service()
            blob_name = _blob_path("results", "training", run_id, "result.json")
            blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
            data = blob_client.download_blob().readall()
            result = json.loads(data)

            local_path.parent.mkdir(parents=True, exist_ok=True)
            local_path.write_text(data.decode("utf-8") if isinstance(data, bytes) else data)
            logger.info("Training result fetched from Azure and cached: %s", run_id)
            return result
        except Exception as e:
            logger.debug("No Azure training result for %s: %s", run_id, e)
            return None

    def save_clustering_result(self, run_id: str, result_dict: dict) -> str:
        content = json.dumps(result_dict, indent=2, default=str)

        # Always save locally first (guaranteed to work)
        local_dir = PROCESSED_DATA_DIR / run_id
        local_dir.mkdir(parents=True, exist_ok=True)
        local_path = local_dir / "clustering_result.json"
        local_path.write_text(content)
        logger.info("Clustering result saved locally: %s", run_id)

        # Best-effort Azure upload (non-blocking with timeout)
        try:
            def _azure_upload():
                blob_service = _get_blob_service()
                blob_name = _blob_path("results", "clustering", run_id, "result.json")
                blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
                blob_client.upload_blob(content, overwrite=True)

            _run_with_timeout(_azure_upload)
            logger.info("Clustering result persisted to Azure + local: %s", run_id)
        except TimeoutError:
            logger.warning(
                "Azure clustering result upload timed out after %ss; local copy saved for %s",
                _AZURE_WRITE_TIMEOUT_SECS, run_id,
            )
        except Exception as e:
            logger.warning("Azure clustering result upload failed for %s: %s (local copy saved)", run_id, e)

        return str(local_path)

    def get_clustering_result(self, run_id: str) -> dict | None:
        local_path = PROCESSED_DATA_DIR / run_id / "clustering_result.json"
        if local_path.exists():
            try:
                return json.loads(local_path.read_text())
            except Exception:
                pass

        try:
            blob_service = _get_blob_service()
            blob_name = _blob_path("results", "clustering", run_id, "result.json")
            blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
            data = blob_client.download_blob().readall()
            result = json.loads(data)

            local_path.parent.mkdir(parents=True, exist_ok=True)
            local_path.write_text(data.decode("utf-8") if isinstance(data, bytes) else data)
            return result
        except Exception as e:
            logger.debug("No Azure clustering result for %s: %s", run_id, e)
            return None

    def save_model_binary(self, run_id: str, filename: str, local_path: str) -> str:
        try:
            src = Path(local_path)
            if src.exists():
                blob_service = _get_blob_service()
                blob_name = _blob_path("models", run_id, filename)
                blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
                with open(str(src), "rb") as f:
                    blob_client.upload_blob(f, overwrite=True)
                logger.info("Model binary uploaded to Azure: %s", blob_name)
            return local_path
        except Exception as e:
            logger.warning("Failed to upload model binary to Azure: %s", e)
            return local_path

    def get_model_binary(self, run_id: str, filename: str) -> str | None:
        run_dir = MODELS_DIR / run_id
        local_path = run_dir / filename
        if local_path.exists():
            return str(local_path)

        if run_dir.exists():
            for f in run_dir.iterdir():
                if f.is_file():
                    return str(f)

        try:
            blob_service = _get_blob_service()
            blob_name = _blob_path("models", run_id, filename)
            blob_client = blob_service.get_blob_client(AZURE_BLOB_CONTAINER_NAME, blob_name)
            data = blob_client.download_blob().readall()

            run_dir.mkdir(parents=True, exist_ok=True)
            local_path.write_bytes(data)
            logger.info("Model binary downloaded from Azure: %s", blob_name)
            return str(local_path)
        except Exception as e:
            logger.debug("No Azure model binary for %s/%s: %s", run_id, filename, e)
            return None

    def list_training_runs(self) -> list[str]:
        run_ids = set()
        try:
            blob_service = _get_blob_service()
            container_client = blob_service.get_container_client(AZURE_BLOB_CONTAINER_NAME)
            prefix = _blob_path("results", "training") + "/"
            blobs = container_client.list_blobs(name_starts_with=prefix)
            for blob in blobs:
                rel = blob.name[len(prefix):]
                if rel and "/" in rel:
                    run_ids.add(rel.split("/", 1)[0])
        except Exception:
            pass

        if PROCESSED_DATA_DIR.exists():
            for d in PROCESSED_DATA_DIR.iterdir():
                if d.is_dir() and (d / "training_result.json").exists():
                    run_ids.add(d.name)

        return list(run_ids)

    def delete_training_result(self, run_id: str):
        try:
            blob_service = _get_blob_service()
            container_client = blob_service.get_container_client(AZURE_BLOB_CONTAINER_NAME)
            for base in (
                _blob_path("results", "training", run_id) + "/",
                _blob_path("results", "clustering", run_id) + "/",
            ):
                blobs = container_client.list_blobs(name_starts_with=base)
                for blob in blobs:
                    container_client.delete_blob(blob.name)
        except Exception as e:
            logger.warning("Azure result cleanup failed for %s: %s", run_id, e)

        import shutil
        for base_dir in [PROCESSED_DATA_DIR, MODELS_DIR]:
            target = base_dir / run_id
            if target.exists():
                shutil.rmtree(target)