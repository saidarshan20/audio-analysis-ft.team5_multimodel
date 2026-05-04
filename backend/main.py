from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware # <--- ADD THIS IMPORT
import os
from fastapi.staticfiles import StaticFiles
# Import core Integration Routers
from core.auth_router import router as auth_router


from core.chat_router import router as chat_router 
from core.kaggle_hub_router import router as kaggle_hub_router
from core.blob_router import router as blob_router
from core.project_router import router as project_router
from core.core_db import create_tables
import core.project_models  # noqa: F401 — ensure tables are registered with Base
#Import Core Integration Routers



# # Import Team Routers (Add more as teams finish)
from modules.team1_automl.router import router as t1_router
from modules.team2_feature_eng.router import router as t2_router
from modules.team3_ocr.router import router as t3_router
from modules.team4_anonymization.router import router as t4_router
from modules.team4_anonymization.viz.router import router as t4_viz_router
from modules.team5_multimodal.router import router as t5_router

# Import Team Routers (Add more as teams finish)

# 1. Ensure Shared Workspace folders exist
os.makedirs("shared_workspace/1_raw_uploads", exist_ok=True)
os.makedirs("shared_workspace/2_processed_data", exist_ok=True)
os.makedirs("shared_workspace/3_models", exist_ok=True)

app = FastAPI(title="Data2Insight AI")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, replace "*" with your React app URL e.g., ["http://localhost:3000"]
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# 2. Plug in the UI/Core modules
app.include_router(auth_router)
app.include_router(chat_router)
app.include_router(kaggle_hub_router)
app.include_router(blob_router)
app.include_router(project_router)
# 2. Plug in the UI/Core modules

# Create all database tables on startup (idempotent)
create_tables()
# 2. Plug in the UI/Core modules
# 3. Plug in the Team modules
app.include_router(t1_router)
app.include_router(t2_router)
app.include_router(t3_router)
app.include_router(t4_router)
app.include_router(t4_viz_router)
app.include_router(t5_router)
# Run with: uvicorn main:app --reload

# 4. Mount the static files directory so the UI can fetch images # <--- 2. ADD THIS LINE
app.mount("/shared_workspace", StaticFiles(directory="shared_workspace"), name="shared_workspace")
app.mount("/modules", StaticFiles(directory="modules"), name="modules")