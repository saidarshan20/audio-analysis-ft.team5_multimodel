"""
session_models.py - WorkflowSession ORM Model

Self-contained model for workflow session persistence.
No auth/username dependency — this is a single-user application.
"""

from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class WorkflowSession(Base):
    """Tracks persistent feature engineering sessions so users can resume."""
    __tablename__ = "workflow_sessions"

    id = Column(String, primary_key=True)              # session_id (UUID)
    dataset_name = Column(String, default="")           # original filename
    current_step = Column(String, default="profile")    # profile/quality/generate/preview/export
    current_stage = Column(Integer, default=0)          # sub-stage within generate (0-4)
    target_col = Column(String, default="")             # target column name
    created_at = Column(String, default="")             # ISO timestamp
    updated_at = Column(String, default="")             # ISO timestamp
    rows = Column(Integer, default=0)                   # dataset row count
    cols = Column(Integer, default=0)                   # dataset column count
