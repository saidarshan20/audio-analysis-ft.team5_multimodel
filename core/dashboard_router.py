"""
dashboard_router.py  –  Placeholder for future dashboard routes.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/")
def dashboard_home():
    return {"message": "Dashboard coming soon."}
