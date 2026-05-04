"""
Project Management & Activity Tracking — Database Models & Schemas
All project/activity state lives here. No user management (single-user app).
"""

from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from pydantic import BaseModel
from .core_db import Base


# ── SQLAlchemy ORM Tables ─────────────────────────────────────────────────────

class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    status = Column(String, default="active")  # 'active' | 'completed'
    starting_tool = Column(String, nullable=False)  # ocr | viz | feat | anon | automl
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    completed_at = Column(DateTime, nullable=True)

    steps = relationship("ProjectStep", back_populates="project", cascade="all, delete-orphan", order_by="ProjectStep.started_at")
    activities = relationship("ActivityLog", back_populates="project", cascade="all, delete-orphan", order_by="ActivityLog.timestamp.desc()")


class ProjectStep(Base):
    __tablename__ = "project_steps"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    tool_key = Column(String, nullable=False)  # ocr | viz | feat | anon | automl
    started_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    ended_at = Column(DateTime, nullable=True)
    metadata_json = Column(Text, nullable=True)  # Optional JSON string for extra data (rows processed, etc.)

    project = relationship("Project", back_populates="steps")


class ActivityLog(Base):
    __tablename__ = "activity_log"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    tool_key = Column(String, nullable=True)
    action = Column(String, nullable=False)  # e.g. 'opened_tool', 'completed_step', 'created_project'
    description = Column(String, nullable=False)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    project = relationship("Project", foreign_keys=[project_id], uselist=False, viewonly=True)


# ── Pydantic Schemas ──────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str
    starting_tool: str  # ocr | viz | feat | anon | automl


class StepCreate(BaseModel):
    tool_key: str


class StepOut(BaseModel):
    id: int
    tool_key: str
    started_at: str
    ended_at: Optional[str] = None
    metadata_json: Optional[str] = None

    class Config:
        from_attributes = True


class ActivityOut(BaseModel):
    id: int
    project_id: Optional[int] = None
    tool_key: Optional[str] = None
    action: str
    description: str
    timestamp: str
    project_name: Optional[str] = None  # Joined from project table

    class Config:
        from_attributes = True


class ProjectOut(BaseModel):
    id: int
    name: str
    status: str
    starting_tool: str
    created_at: str
    completed_at: Optional[str] = None
    steps: List[StepOut] = []
    total_duration_seconds: int = 0
    module_count: int = 0

    class Config:
        from_attributes = True


class ActivityCreate(BaseModel):
    project_id: Optional[int] = None
    tool_key: Optional[str] = None
    action: str
    description: str
