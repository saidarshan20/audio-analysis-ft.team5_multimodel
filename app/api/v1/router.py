from fastapi import APIRouter
from app.api.v1.endpoints import text

router = APIRouter(prefix="/api/v1")
router.include_router(text.router)
