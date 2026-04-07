"""
run_local.py  –  Standalone test server for Team 5 Multimodal.
Run:  python -m modules.team5_multimodal.run_local
       or:  cd modules/team5_multimodal && python run_local.py
Swagger UI at http://localhost:8005/docs
"""

import sys
import os

# Ensure project root is on sys.path so imports like `modules.team5_multimodal.*` work
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from modules.team5_multimodal.router import router
from modules.team5_multimodal.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title="Team 5 – Multimodal (Local)",
        version="0.1.0",
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(router)
    return application


app = create_app()

if __name__ == "__main__":
    uvicorn.run("modules.team5_multimodal.run_local:app", host="0.0.0.0", port=8000, reload=True)
