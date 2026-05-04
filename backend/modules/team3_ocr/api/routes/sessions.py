"""
Session endpoints — save and load UI sessions as physical JSON files.
"""

import json
from pathlib import Path
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from modules.team3_ocr.config import settings
from modules.team3_ocr.api.dependencies import verify_auth, get_blob_storage
from modules.team3_ocr.api.schemas.ocr_schemas import OcrSession, SessionListItem, SessionListResponse
from modules.team3_ocr.storage import BlobPaths

router = APIRouter(prefix="/sessions", tags=["Team 3 - OCR"], dependencies=[Depends(verify_auth)])

def _safe_token(value: str) -> str:
    return "".join(c for c in (value or "") if c.isalnum() or c in ("-", "_")).strip() or "untitled"


def _get_session_path(session_name: str, session_id: str) -> Path:
    safe_name = _safe_token(session_name)
    safe_id = _safe_token(session_id)
    return Path(settings.sessions_dir) / safe_name / f"{safe_id}.json"

def _iter_local_session_files() -> List[Path]:
    sessions_dir = Path(settings.sessions_dir)
    if not sessions_dir.exists():
        return []
    return [p for p in sessions_dir.rglob("*.json") if p.is_file()]

def _find_blob_session_name_by_id(blob, paths: BlobPaths, safe_id: str) -> str | None:
    # Stored as ocr-workspace/sessions/<safe_name>/<safe_id>.json
    suffix = f"/{safe_id}.json"
    for name in blob.list(paths.sessions_prefix):
        if name.endswith(suffix):
            return name[len(paths.sessions_prefix):].split("/", 1)[0]
    # Backward compatibility: flat layout ocr-workspace/sessions/<safe_id>.json
    flat = f"{paths.sessions_prefix}{safe_id}.json"
    for name in blob.list(paths.sessions_prefix):
        if name == flat:
            return ""
    return None

@router.post("", response_model=dict)
async def save_session(session: OcrSession):
    """Save a session JSON to the shared sessions directory."""
    payload = json.dumps(session.model_dump(), ensure_ascii=False, indent=2).encode("utf-8")

    if settings.storage_provider == "azure":
        blob = get_blob_storage()
        if blob.is_available():
            paths = BlobPaths()
            safe_name = _safe_token(session.name)
            safe_id = _safe_token(session.id)
            blob.upload_bytes(paths.session_blob_name(safe_name, safe_id), payload, content_type="application/json")
            return {"success": True, "message": f"Session {session.name} saved to blob storage."}

    path = _get_session_path(session.name, session.id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(payload)
    return {"success": True, "message": f"Session {session.name} saved to disk."}

@router.get("", response_model=SessionListResponse)
async def list_sessions():
    """List all available session files."""
    if settings.storage_provider == "azure":
        blob = get_blob_storage()
        if blob.is_available():
            paths = BlobPaths()
            items = []
            for name in blob.list(paths.sessions_prefix):
                if not name.endswith(".json"):
                    continue
                raw = blob.download_bytes(name)
                if not raw:
                    continue
                try:
                    data = json.loads(raw.decode("utf-8"))
                    items.append(SessionListItem(
                        id=data.get("id"),
                        name=data.get("name"),
                        timestamp=data.get("timestamp"),
                    ))
                except Exception:
                    continue
            items.sort(key=lambda x: x.timestamp, reverse=True)
            return SessionListResponse(sessions=items)

    items = []
    for p in _iter_local_session_files():
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
                items.append(SessionListItem(
                    id=data.get("id"),
                    name=data.get("name"),
                    timestamp=data.get("timestamp")
                ))
        except Exception:
            continue

    items.sort(key=lambda x: x.timestamp, reverse=True)
    return SessionListResponse(sessions=items)

@router.get("/{session_id}", response_model=OcrSession)
async def get_session(session_id: str):
    """Load a specific session file."""
    safe_id = _safe_token(session_id)

    if settings.storage_provider == "azure":
        blob = get_blob_storage()
        if blob.is_available():
            paths = BlobPaths()
            safe_name = _find_blob_session_name_by_id(blob, paths, safe_id)
            if safe_name is None:
                raise HTTPException(404, "Session file not found")
            if safe_name == "":
                raw = blob.download_bytes(f"{paths.sessions_prefix}{safe_id}.json")
            else:
                raw = blob.download_bytes(paths.session_blob_name(safe_name, safe_id))
            if not raw:
                raise HTTPException(404, "Session file not found")
            return json.loads(raw.decode("utf-8"))

    # Local nested layout first
    for p in _iter_local_session_files():
        if p.name == f"{safe_id}.json":
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
    raise HTTPException(404, "Session file not found")

@router.delete("/{session_id}")
async def delete_session(session_id: str):
    """Delete a session file."""
    safe_id = _safe_token(session_id)

    if settings.storage_provider == "azure":
        blob = get_blob_storage()
        if blob.is_available():
            paths = BlobPaths()
            safe_name = _find_blob_session_name_by_id(blob, paths, safe_id)
            if safe_name is None:
                raise HTTPException(404, "Session file not found")
            if safe_name == "":
                blob.delete(f"{paths.sessions_prefix}{safe_id}.json")
            else:
                blob.delete(paths.session_blob_name(safe_name, safe_id))
            return {"success": True, "message": "Session deleted from blob storage."}

    deleted = False
    for p in _iter_local_session_files():
        if p.name == f"{safe_id}.json":
            try:
                p.unlink()
                deleted = True
            except Exception:
                pass
    if not deleted:
        raise HTTPException(404, "Session file not found")
    return {"success": True, "message": "Session deleted from disk."}
