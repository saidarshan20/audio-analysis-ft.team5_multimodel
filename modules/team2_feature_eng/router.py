"""
router.py  –  MANDATORY router for Team 2 (Feature Engineering).
"""

from fastapi import APIRouter

router = APIRouter(prefix="/team2", tags=["Team 2 - Feature Engineering"])


@router.get("/health")
def health():
    return {"team": "team2_feature_eng", "status": "ok"}
