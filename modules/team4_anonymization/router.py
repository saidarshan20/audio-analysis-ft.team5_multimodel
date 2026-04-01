"""
router.py  –  MANDATORY router for Team 4 (Anonymization).
"""

from fastapi import APIRouter

router = APIRouter(prefix="/team4", tags=["Team 4 - Anonymization"])


@router.get("/health")
def health():
    return {"team": "team4_anonymization", "status": "ok"}
