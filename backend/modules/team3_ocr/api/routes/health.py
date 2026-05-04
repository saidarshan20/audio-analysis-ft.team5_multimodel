"""
Health check endpoint — used by UI team and load balancers to verify the API is running.
"""

from fastapi import APIRouter
from modules.team3_ocr.config import settings

router = APIRouter(tags=["Team 3 - OCR"])


@router.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": settings.app_name,
        "environment": settings.app_env,
        "providers": {
            "ocr": settings.ocr_provider,
            "nlp": settings.nlp_provider,
            "search": settings.search_provider,
            "storage": settings.storage_provider,
        },
    }
