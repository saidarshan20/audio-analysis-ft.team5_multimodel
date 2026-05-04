"""
session.py - Session Management with Persistence

Sessions are cached in-memory during active use and persisted to
Azure Blob Storage (or local disk) so users can resume after closing the browser.

SQLite (session/session.db) stores lightweight session metadata for listing/lookup.
Heavy data (DataFrames) is stored via storage.py (Blob → Local fallback).

NOTE: This is a single-user application — no auth/username filtering.
All sessions are visible to everyone.
"""

import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional

from . import storage

# ─── In-memory cache (fast access for active sessions) ────────────────────────
_sessions: Dict[str, Dict[str, Any]] = {}


def create_session() -> str:
    """Create a new session, register it in SQLite, return session_id."""
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    _sessions[session_id] = {
        "original_df": None,
        "current_df": None,
        "filename": None,
        "target_col": None,
        "history": [],
        "dq_suggestions": [],
        "feature_cache": {},
    }

    # Register in SQLite for listing/lookup
    try:
        from .session_store.session_db import SessionDBLocal
        from .session_store.session_models import WorkflowSession
        db = SessionDBLocal()
        try:
            ws = WorkflowSession(
                id=session_id,
                dataset_name="",
                current_step="profile",
                current_stage=0,
                target_col="",
                created_at=now,
                updated_at=now,
                rows=0,
                cols=0,
            )
            db.add(ws)
            db.commit()
        finally:
            db.close()
    except Exception as e:
        print(f"[session] SQLite registration failed (non-fatal): {e}")

    return session_id


def get_session(session_id: str) -> Dict[str, Any]:
    """
    Get session data. Checks in-memory cache first, then tries to
    load from persistent storage (for resumed sessions).
    """
    if session_id in _sessions:
        return _sessions[session_id]

    # Try to restore from persistent storage
    restored = _restore_session(session_id)
    if restored is not None:
        _sessions[session_id] = restored
        return restored

    raise KeyError("Session not found")


def save_session(session_id: str):
    """
    Persist the current session state to storage (Blob → Local fallback).
    Also updates the SQLite metadata row.
    """
    if session_id not in _sessions:
        return

    session = _sessions[session_id]

    # 1. Save DataFrames
    if session.get("current_df") is not None:
        storage.save_dataframe(session_id, "current_df", session["current_df"])
    if session.get("original_df") is not None:
        storage.save_dataframe(session_id, "original_df", session["original_df"])

    # 2. Build JSON-serializable metadata (everything except DataFrames)
    metadata = {}
    skip_keys = {"original_df", "current_df"}
    for key, value in session.items():
        if key in skip_keys:
            continue
        try:
            import json
            json.dumps(value, default=str)  # test if serializable
            metadata[key] = value
        except (TypeError, ValueError):
            pass  # skip non-serializable values

    storage.save_metadata(session_id, metadata)

    # 3. Update SQLite row
    _update_sqlite_metadata(session_id, session)


def save_progress(session_id: str, step: str, stage: int = 0):
    """Update just the step/stage progress in SQLite."""
    try:
        from .session_store.session_db import SessionDBLocal
        from .session_store.session_models import WorkflowSession
        db = SessionDBLocal()
        try:
            ws = db.query(WorkflowSession).filter(WorkflowSession.id == session_id).first()
            if ws:
                ws.current_step = step
                ws.current_stage = stage
                ws.updated_at = datetime.now(timezone.utc).isoformat()
                db.commit()
        finally:
            db.close()
    except Exception as e:
        print(f"[session] save_progress failed (non-fatal): {e}")


def list_all_sessions() -> List[Dict[str, Any]]:
    """Return all saved sessions from SQLite (single-user — no filtering)."""
    # First, clean up expired sessions
    _cleanup_expired_sessions()

    try:
        from .session_store.session_db import SessionDBLocal
        from .session_store.session_models import WorkflowSession
        db = SessionDBLocal()
        try:
            rows = (
                db.query(WorkflowSession)
                .order_by(WorkflowSession.updated_at.desc())
                .all()
            )
            return [
                {
                    "session_id": r.id,
                    "dataset_name": r.dataset_name,
                    "current_step": r.current_step,
                    "current_stage": r.current_stage,
                    "target_col": r.target_col,
                    "created_at": r.created_at,
                    "updated_at": r.updated_at,
                    "rows": r.rows,
                    "cols": r.cols,
                }
                for r in rows
            ]
        finally:
            db.close()
    except Exception as e:
        print(f"[session] list_all_sessions failed: {e}")
        return []


def delete_session(session_id: str):
    """Remove a session from memory, storage, and SQLite."""
    _sessions.pop(session_id, None)
    storage.delete_session_storage(session_id)

    try:
        from .session_store.session_db import SessionDBLocal
        from .session_store.session_models import WorkflowSession
        db = SessionDBLocal()
        try:
            db.query(WorkflowSession).filter(WorkflowSession.id == session_id).delete()
            db.commit()
        finally:
            db.close()
    except Exception as e:
        print(f"[session] delete_session SQLite cleanup failed: {e}")


def resume_session(session_id: str) -> Dict[str, Any]:
    """
    Load a persisted session back into memory and return all cached data
    needed for the frontend to restore its state.
    """
    session = get_session(session_id)  # loads from storage if needed

    # Build the response payload with everything the frontend needs
    result = {
        "session_id": session_id,
        "dataset_name": session.get("filename", ""),
        "target_col": session.get("target_col", ""),
    }

    # Get step/stage from SQLite
    try:
        from .session_store.session_db import SessionDBLocal
        from .session_store.session_models import WorkflowSession
        db = SessionDBLocal()
        try:
            ws = db.query(WorkflowSession).filter(WorkflowSession.id == session_id).first()
            if ws:
                result["current_step"] = ws.current_step
                result["current_stage"] = ws.current_stage
                result["rows"] = ws.rows
                result["cols"] = ws.cols
        finally:
            db.close()
    except Exception:
        pass

    # Include cached profile data if available
    if session.get("profile_data"):
        result["profile_data"] = session["profile_data"]

    # Include cached quality data if available
    if session.get("quality_result_cache"):
        result["quality_data"] = session["quality_result_cache"]

    # Include dataset info
    df = session.get("current_df")
    if df is not None:
        result["rows"] = len(df)
        result["cols"] = len(df.columns)

    return result


# ═══════════════════════════════════════════════════════════════════════════════
# INTERNAL HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def _restore_session(session_id: str) -> Optional[Dict[str, Any]]:
    """Try to load a session from persistent storage."""
    metadata = storage.load_metadata(session_id)
    if metadata is None:
        return None

    current_df = storage.load_dataframe(session_id, "current_df")
    original_df = storage.load_dataframe(session_id, "original_df")

    if current_df is None:
        return None  # Can't resume without the dataset

    session = {
        "original_df": original_df,
        "current_df": current_df,
        "filename": metadata.get("filename"),
        "target_col": metadata.get("target_col"),
        "history": metadata.get("history", []),
        "dq_suggestions": metadata.get("dq_suggestions", []),
        "feature_cache": metadata.get("feature_cache", {}),
        "profile_data": metadata.get("profile_data"),
        "quality_suggestions": metadata.get("quality_suggestions", {}),
        "quality_result_cache": metadata.get("quality_result_cache"),
    }

    return session


def _update_sqlite_metadata(session_id: str, session: Dict[str, Any]):
    """Update the SQLite row with current session info."""
    try:
        from .session_store.session_db import SessionDBLocal
        from .session_store.session_models import WorkflowSession
        db = SessionDBLocal()
        try:
            ws = db.query(WorkflowSession).filter(WorkflowSession.id == session_id).first()
            if ws:
                ws.dataset_name = session.get("filename", "") or ""
                ws.target_col = session.get("target_col", "") or ""
                ws.updated_at = datetime.now(timezone.utc).isoformat()

                df = session.get("current_df")
                if df is not None:
                    ws.rows = len(df)
                    ws.cols = len(df.columns)

                db.commit()
        finally:
            db.close()
    except Exception as e:
        print(f"[session] SQLite metadata update failed (non-fatal): {e}")


def _cleanup_expired_sessions():
    """Delete sessions older than 1 month."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    try:
        from .session_store.session_db import SessionDBLocal
        from .session_store.session_models import WorkflowSession
        db = SessionDBLocal()
        try:
            expired = (
                db.query(WorkflowSession)
                .filter(WorkflowSession.updated_at < cutoff)
                .all()
            )
            for ws in expired:
                storage.delete_session_storage(ws.id)
                _sessions.pop(ws.id, None)
                db.delete(ws)
            if expired:
                db.commit()
                print(f"[session] Cleaned up {len(expired)} expired session(s)")
        finally:
            db.close()
    except Exception as e:
        print(f"[session] Cleanup failed (non-fatal): {e}")
