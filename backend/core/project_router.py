"""
Project Management & Activity Tracking — API Router
All endpoints live under /api/projects and /api/activity.
"""

from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from .core_db import get_db
from .project_models import (
    Project, ProjectStep, ActivityLog,
    ProjectCreate, StepCreate, ProjectOut, StepOut, ActivityOut, ActivityCreate,
)

router = APIRouter(tags=["Core: Project Management"])


# ── Helpers ───────────────────────────────────────────────────────────────────

TOOL_LABELS = {
    "ocr": "OCR Conversion",
    "viz": "Data Visualization",
    "feat": "Feature Engineering",
    "anon": "Data Anonymization",
    "automl": "AutoML",
}


def _dt_str(dt: Optional[datetime]) -> Optional[str]:
    """Convert datetime to ISO string or None."""
    return dt.isoformat() if dt else None


def _calc_duration(steps) -> int:
    """Total seconds across all steps that have ended."""
    total = 0
    for s in steps:
        if s.started_at and s.ended_at:
            total += int((s.ended_at - s.started_at).total_seconds())
    return total


def _unique_tools(steps) -> int:
    """Count distinct tools visited."""
    return len(set(s.tool_key for s in steps))


def _project_to_out(p: Project) -> dict:
    """Convert a Project ORM object to a response dict."""
    steps_out = []
    for s in p.steps:
        steps_out.append({
            "id": s.id,
            "tool_key": s.tool_key,
            "started_at": _dt_str(s.started_at),
            "ended_at": _dt_str(s.ended_at),
            "metadata_json": s.metadata_json,
        })
    return {
        "id": p.id,
        "name": p.name,
        "status": p.status,
        "starting_tool": p.starting_tool,
        "created_at": _dt_str(p.created_at),
        "completed_at": _dt_str(p.completed_at),
        "steps": steps_out,
        "total_duration_seconds": _calc_duration(p.steps),
        "module_count": _unique_tools(p.steps),
    }


# ── Bulk close (must be defined BEFORE /{project_id} routes) ──────────────────

@router.post("/api/projects/close-all-open")
def close_all_open_steps(db: Session = Depends(get_db)):
    """
    Called when the browser is about to close.
    Ends all open steps and marks all active projects as completed.
    """
    now = datetime.now(timezone.utc)

    open_steps = db.query(ProjectStep).filter(ProjectStep.ended_at.is_(None)).all()
    for s in open_steps:
        s.ended_at = now

    active_projects = db.query(Project).filter(Project.status == "active").all()
    for p in active_projects:
        p.status = "completed"
        p.completed_at = now
        activity = ActivityLog(
            project_id=p.id,
            action="auto_completed",
            description=f"Project \"{p.name}\" auto-completed on session close",
        )
        db.add(activity)

    db.commit()
    return {"message": f"Closed {len(open_steps)} steps, completed {len(active_projects)} projects"}


# ── Project CRUD ──────────────────────────────────────────────────────────────

@router.post("/api/projects")
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    """Create a new project and auto-log the first step + activity."""
    project = Project(
        name=body.name,
        status="active",
        starting_tool=body.starting_tool,
    )
    db.add(project)
    db.flush()  # get project.id

    # Auto-create the first step
    first_step = ProjectStep(
        project_id=project.id,
        tool_key=body.starting_tool,
    )
    db.add(first_step)

    # Auto-log activity
    tool_label = TOOL_LABELS.get(body.starting_tool, body.starting_tool)
    activity = ActivityLog(
        project_id=project.id,
        tool_key=body.starting_tool,
        action="created_project",
        description=f"Created project \"{body.name}\" starting with {tool_label}",
    )
    db.add(activity)
    db.commit()
    db.refresh(project)
    return _project_to_out(project)


@router.get("/api/projects")
def list_projects(
    status: Optional[str] = Query(None, description="Filter by 'active' or 'completed'"),
    db: Session = Depends(get_db),
):
    """List all projects, optionally filtered by status."""
    q = db.query(Project).order_by(Project.created_at.desc())
    if status:
        q = q.filter(Project.status == status)
    projects = q.all()
    return {"projects": [_project_to_out(p) for p in projects]}


@router.get("/api/projects/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db)):
    """Get a single project with full details."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return _project_to_out(project)


@router.patch("/api/projects/{project_id}/complete")
def complete_project(project_id: int, db: Session = Depends(get_db)):
    """Mark a project as completed. Also ends any open steps."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    now = datetime.now(timezone.utc)
    project.status = "completed"
    project.completed_at = now

    # End any still-open steps
    open_steps = db.query(ProjectStep).filter(
        ProjectStep.project_id == project_id,
        ProjectStep.ended_at.is_(None),
    ).all()
    for step in open_steps:
        step.ended_at = now

    # Log activity
    activity = ActivityLog(
        project_id=project_id,
        action="completed_project",
        description=f"Completed project \"{project.name}\"",
    )
    db.add(activity)
    db.commit()
    db.refresh(project)
    return _project_to_out(project)


@router.delete("/api/projects/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)):
    """Delete a project and all its steps/activities."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()
    return {"message": "Project deleted", "id": project_id}


# ── Step Tracking ─────────────────────────────────────────────────────────────

@router.post("/api/projects/{project_id}/steps")
def start_step(project_id: int, body: StepCreate, db: Session = Depends(get_db)):
    """Log that the user opened a tool within a project."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # End any previously open steps for this project
    open_steps = db.query(ProjectStep).filter(
        ProjectStep.project_id == project_id,
        ProjectStep.ended_at.is_(None),
    ).all()
    now = datetime.now(timezone.utc)
    for s in open_steps:
        s.ended_at = now

    # Create new step
    step = ProjectStep(
        project_id=project_id,
        tool_key=body.tool_key,
    )
    db.add(step)

    # Log activity
    tool_label = TOOL_LABELS.get(body.tool_key, body.tool_key)
    activity = ActivityLog(
        project_id=project_id,
        tool_key=body.tool_key,
        action="opened_tool",
        description=f"Opened {tool_label} in project \"{project.name}\"",
    )
    db.add(activity)
    db.commit()
    db.refresh(step)

    return {
        "id": step.id,
        "tool_key": step.tool_key,
        "started_at": _dt_str(step.started_at),
    }


@router.patch("/api/projects/{project_id}/steps/{step_id}/end")
def end_step(project_id: int, step_id: int, db: Session = Depends(get_db)):
    """Mark a tool visit as ended."""
    step = db.query(ProjectStep).filter(
        ProjectStep.id == step_id,
        ProjectStep.project_id == project_id,
    ).first()
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")

    step.ended_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(step)

    return {
        "id": step.id,
        "tool_key": step.tool_key,
        "started_at": _dt_str(step.started_at),
        "ended_at": _dt_str(step.ended_at),
    }





# ── Activity Feed ─────────────────────────────────────────────────────────────

@router.get("/api/activity")
def get_activity(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Get the most recent activity entries."""
    activities = (
        db.query(ActivityLog)
        .order_by(ActivityLog.timestamp.desc())
        .limit(limit)
        .all()
    )

    result = []
    for a in activities:
        # Get project name if linked
        project_name = None
        if a.project_id:
            proj = db.query(Project).filter(Project.id == a.project_id).first()
            if proj:
                project_name = proj.name

        result.append({
            "id": a.id,
            "project_id": a.project_id,
            "tool_key": a.tool_key,
            "action": a.action,
            "description": a.description,
            "timestamp": _dt_str(a.timestamp),
            "project_name": project_name,
        })

    return {"activities": result}


@router.post("/api/activity")
def log_activity(body: ActivityCreate, db: Session = Depends(get_db)):
    """Manually log an activity event."""
    activity = ActivityLog(
        project_id=body.project_id,
        tool_key=body.tool_key,
        action=body.action,
        description=body.description,
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return {
        "id": activity.id,
        "action": activity.action,
        "description": activity.description,
        "timestamp": _dt_str(activity.timestamp),
    }
