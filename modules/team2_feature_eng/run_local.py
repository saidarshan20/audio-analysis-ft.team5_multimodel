"""
run_local.py  –  Standalone test server for Team 2 Feature Engineering.
Swagger UI at http://localhost:8002/docs
"""

import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import uvicorn
from fastapi import FastAPI
from modules.team2_feature_eng.router import router

app = FastAPI(title="Team 2 – Feature Engineering (Local)", version="0.1.0")
app.include_router(router)

if __name__ == "__main__":
    uvicorn.run("modules.team2_feature_eng.run_local:app", host="0.0.0.0", port=8002, reload=True)
