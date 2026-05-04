"""
audit_models.py - Audit Logging Models

This file defines the database schema and Pydantic models for audit logging
in the Feature Engineering module.

LOGGED OPERATIONS:
- Data Quality: Apply fixes, Regenerate fixes
- Feature Creation: Get suggestions, Apply features, Regenerate features
- Scaling: Get suggestions, Apply scaling, Regenerate scaling
- Custom Transforms: Apply custom transformation
"""

from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

Base = declarative_base()


# ═══════════════════════════════════════════════════════════════════════════
# SQLAlchemy Model
# ═══════════════════════════════════════════════════════════════════════════

class AuditLog(Base):
    """
    Audit log table for tracking Feature Engineering operations.
    
    Fields:
    - id: Primary key
    - user_id: ID of the user who performed the action
    - session_id: Session ID associated with the operation
    - action_type: Type of action (e.g., 'apply_fixes', 'apply_features', etc.)
    - action_category: Category (e.g., 'data_quality', 'feature_creation', etc.)
    - details: JSON string with additional details about the operation
    - created_at: Timestamp when the log was created
    - updated_at: Timestamp when the log was last updated
    """
    __tablename__ = "audit_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    session_id = Column(String, nullable=False, index=True)
    action_type = Column(String, nullable=False)  # e.g., 'apply_fixes', 'apply_features'
    action_category = Column(String, nullable=False)  # e.g., 'data_quality', 'feature_creation'
    details = Column(Text, nullable=True)  # JSON string with operation details
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


# ═══════════════════════════════════════════════════════════════════════════
# Pydantic Schemas (For API Validation and Response)
# ═══════════════════════════════════════════════════════════════════════════

class AuditLogCreate(BaseModel):
    """Schema for creating a new audit log entry"""
    user_id: int
    session_id: str
    action_type: str
    action_category: str
    details: Optional[Dict[str, Any]] = None


class AuditLogResponse(BaseModel):
    """Schema for audit log API responses"""
    id: int
    user_id: int
    session_id: str
    action_type: str
    action_category: str
    details: Optional[Dict[str, Any]] = None
    timestamp: datetime  # Frontend expects 'timestamp'
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class AuditLogFilter(BaseModel):
    """Schema for filtering audit logs"""
    user_id: Optional[int] = None
    session_id: Optional[str] = None
    action_category: Optional[str] = None
    limit: Optional[int] = 100
    offset: Optional[int] = 0


class AuditLogsListResponse(BaseModel):
    """Schema for paginated audit logs list"""
    total: int
    logs: List[AuditLogResponse]
