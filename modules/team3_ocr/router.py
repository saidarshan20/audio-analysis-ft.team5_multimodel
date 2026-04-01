"""
router.py  –  MANDATORY router for Team 3 (OCR).
"""

from fastapi import APIRouter

router = APIRouter(prefix="/team3", tags=["Team 3 - OCR"])


@router.get("/health")
def health():
    return {"team": "team3_ocr", "status": "ok"}
