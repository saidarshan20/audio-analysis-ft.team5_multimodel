"""
audit_helper.py - Helper functions for audit logging

This file provides utility functions to easily log operations throughout the application.
"""

from fastapi import Header, HTTPException
from jose import jwt, JWTError
from typing import Optional
from sqlalchemy.orm import Session
from .audit_service import create_audit_log


# JWT Configuration (must match auth_utils.py)
SECRET_KEY = "ai_sphere_secret_key_change_me_later"
ALGORITHM = "HS256"


def get_user_id_from_token(authorization: Optional[str] = Header(None)) -> Optional[int]:
    """
    Extract user_id from JWT token in Authorization header.
    Returns None if no token or invalid token (non-blocking).
    
    Args:
        authorization: Authorization header containing "Bearer <token>"
    
    Returns:
        user_id as integer, or None if not available
    """
    if not authorization:
        return None
    
    try:
        # Extract token from "Bearer <token>"
        if not authorization.startswith("Bearer "):
            return None
        
        token = authorization.split(" ")[1]
        
        # Decode JWT token
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("user_id")
        
        return int(user_id) if user_id else None
    
    except (JWTError, ValueError, IndexError):
        return None


def make_serializable(obj):
    """Convert complex objects to JSON-serializable format."""
    if obj is None:
        return None
    
    # Handle Pydantic models
    if hasattr(obj, 'model_dump'):
        return obj.model_dump()
    
    # Handle objects with dict() method
    if hasattr(obj, 'dict') and callable(getattr(obj, 'dict')):
        return obj.dict()
    
    # Handle lists
    if isinstance(obj, list):
        return [make_serializable(item) for item in obj]
    
    # Handle dicts
    if isinstance(obj, dict):
        return {k: make_serializable(v) for k, v in obj.items()}
    
    # Handle basic types
    if isinstance(obj, (str, int, float, bool)):
        return obj
    
    # Fallback: convert to string
    return str(obj)


def log_audit(
    db: Session,
    user_id: Optional[int],
    session_id: Optional[str],
    action_type: str,
    action_category: str,
    details: Optional[dict] = None
):
    """
    Convenience function to create an audit log entry.
    Safe to call even if user_id or session_id is None.
    
    Args:
        db: Audit database session
        user_id: ID of user (or None for anonymous)
        session_id: Session ID of the operation (or None if not available)
        action_type: Type of action performed
        action_category: Category of the action
        details: Optional dictionary with additional details
    """
    try:
        # Use 0 for anonymous users
        effective_user_id = user_id if user_id is not None else 0
        
        # Use "unknown" for missing session_id
        effective_session_id = session_id if session_id is not None else "unknown"
        
        # Make details JSON-serializable
        if details:
            details = make_serializable(details)
        
        create_audit_log(
            db=db,
            user_id=effective_user_id,
            session_id=effective_session_id,
            action_type=action_type,
            action_category=action_category,
            details=details
        )
        
        # Log success to file for debugging
        import logging
        logging.info(f"Audit log created: {action_type} for user {effective_user_id}")
        
    except Exception as e:
        # Don't fail the main operation if audit logging fails
        import logging
        import traceback
        logging.error(f"Audit logging failed for {action_type}: {str(e)}")
        logging.error(traceback.format_exc())
        print(f"Audit logging failed: {str(e)}")
        print(traceback.format_exc())
