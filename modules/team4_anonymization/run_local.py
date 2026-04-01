"""
run_local.py  –  Standalone test server for Team 4 Anonymization.
Swagger UI at http://localhost:8004/docs
"""

import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import uvicorn
from fastapi import FastAPI
from modules.team4_anonymization.router import router

app = FastAPI(title="Team 4 – Anonymization (Local)", version="0.1.0")
app.include_router(router)

if __name__ == "__main__":
    uvicorn.run("modules.team4_anonymization.run_local:app", host="0.0.0.0", port=8004, reload=True)
