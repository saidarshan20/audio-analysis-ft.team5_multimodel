"""
main.py  –  Integration Team entry point.
Creates the FastAPI app, auto-creates shared_workspace/ directories,
and mounts all team routers + core auth routes.
"""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# ──── Core routers (Integration Team) ────
from core.auth_router import router as auth_router
from core.dashboard_router import router as dashboard_router
from core.core_db import init_db

# ──── Team routers ────
from modules.team1_automl.router import router as team1_router
from modules.team2_feature_eng.router import router as team2_router
from modules.team3_ocr.router import router as team3_router
from modules.team4_anonymization.router import router as team4_router
from modules.team5_multimodal.router import router as team5_router

# ──── Shared workspace directories (auto-created) ────
BASE_DIR = Path(__file__).resolve().parent
WORKSPACE_DIRS = [
    BASE_DIR / "shared_workspace" / "1_raw_uploads",
    BASE_DIR / "shared_workspace" / "2_processed_data",
    BASE_DIR / "shared_workspace" / "3_models",
]


def create_app() -> FastAPI:
    # Ensure workspace dirs exist
    for d in WORKSPACE_DIRS:
        d.mkdir(parents=True, exist_ok=True)

    # Initialise core database (users table)
    init_db()

    application = FastAPI(
        title="AI Kosh – Multimodal Data Visualization",
        description="Unified backend with 5 team modules",
        version="0.1.0",
    )

    # Include both the legacy Vite default (5173) and the new unique port (5742).
    # Override FRONTEND_PORT in .env if you need a different value.
    frontend_port = int(os.getenv("FRONTEND_PORT", os.getenv("VITE_PORT", "5742")))
    cors_origins = list({
        "http://localhost:3000",
        "http://localhost:5173",
        f"http://localhost:{frontend_port}",
    })
    application.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.mount("/shared_workspace", StaticFiles(directory=str(BASE_DIR / "shared_workspace")), name="shared_workspace")

    # ── Mount core routes ──
    application.include_router(auth_router)
    application.include_router(dashboard_router)

    # ── Mount team routes ──
    application.include_router(team1_router)
    application.include_router(team2_router)
    application.include_router(team3_router)
    application.include_router(team4_router)
    application.include_router(team5_router)

    return application


app = create_app()
