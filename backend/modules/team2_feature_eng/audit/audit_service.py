"""
audit_service.py - Audit Logging Service

This file provides functions for creating and retrieving audit logs.
"""

from sqlalchemy.orm import Session
from .audit_models import AuditLog, AuditLogCreate, AuditLogFilter
from typing import List, Optional
import json


def create_audit_log(
    db: Session,
    user_id: int,
    session_id: str,
    action_type: str,
    action_category: str,
    details: Optional[dict] = None
) -> AuditLog:
    """
    Create a new audit log entry.
    
    Args:
        db: Database session
        user_id: ID of the user performing the action
        session_id: Session ID of the operation
        action_type: Type of action (e.g., 'apply_fixes', 'get_suggestions')
        action_category: Category (e.g., 'data_quality', 'feature_creation')
        details: Optional dictionary with additional details (will be JSON serialized)
    
    Returns:
        Created AuditLog object
    """
    details_json = json.dumps(details) if details else None
    
    audit_log = AuditLog(
        user_id=user_id,
        session_id=session_id,
        action_type=action_type,
        action_category=action_category,
        details=details_json
    )
    
    db.add(audit_log)
    db.commit()
    db.refresh(audit_log)
    
    return audit_log


def get_audit_logs(
    db: Session,
    user_id: Optional[int] = None,
    session_id: Optional[str] = None,
    action_category: Optional[str] = None,
    limit: int = 100,
    offset: int = 0
) -> tuple[List[AuditLog], int]:
    """
    Retrieve audit logs with optional filtering.
    
    Args:
        db: Database session
        user_id: Filter by user ID
        session_id: Filter by session ID
        action_category: Filter by action category
        limit: Maximum number of logs to return
        offset: Number of logs to skip (for pagination)
    
    Returns:
        Tuple of (list of AuditLog objects, total count)
    """
    query = db.query(AuditLog)
    
    # Apply filters
    if user_id is not None:
        query = query.filter(AuditLog.user_id == user_id)
    
    if session_id is not None:
        query = query.filter(AuditLog.session_id == session_id)
    
    if action_category is not None:
        query = query.filter(AuditLog.action_category == action_category)
    
    # Get total count before pagination
    total = query.count()
    
    # Apply pagination and ordering
    logs = query.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()
    
    # Convert to response format with timestamp field
    from .audit_models import AuditLogResponse
    log_responses = []
    for log in logs:
        details_obj = json.loads(log.details) if log.details else None
        
        log_dict = {
            "id": log.id,
            "user_id": log.user_id,
            "session_id": log.session_id,
            "action_type": log.action_type,
            "action_category": log.action_category,
            "details": details_obj,
            "timestamp": log.created_at,  # Map created_at to timestamp for frontend
            "created_at": log.created_at,
            "updated_at": log.updated_at
        }
        log_responses.append(AuditLogResponse(**log_dict))
    
    return log_responses, total


def get_audit_log_by_id(db: Session, log_id: int) -> Optional[AuditLog]:
    """
    Retrieve a specific audit log by ID.
    
    Args:
        db: Database session
        log_id: ID of the audit log
    
    Returns:
        AuditLog object or None if not found
    """
    return db.query(AuditLog).filter(AuditLog.id == log_id).first()
