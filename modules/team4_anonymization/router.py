from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
import os
import shutil
import logging

from .services import get_dataset_info, get_data_preview, get_chart_data, RAW_DATA_DIR

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/team4", tags=["Team 4 - Anonymization & Viz"])

class VisualizeRequest(BaseModel):
    filename: str
    x_axis: str
    y_axis: str
    chart_type: str

@router.post("/upload")
async def upload_dataset(file: UploadFile = File(...)):
    """Saves the file to shared workspace and returns basic column metadata."""
    try:
        filename = os.path.basename(file.filename)
        file_path = os.path.join(RAW_DATA_DIR, filename)
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        dataset_info = get_dataset_info(filename)
        return {"message": "File uploaded", "data": dataset_info}
    except Exception as e:
        logger.exception("Upload failed")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/preview")
async def preview_dataset(filename: str):
    """Returns first 100 rows and column-level statistics for a dataset."""
    try:
        data = get_data_preview(filename)
        return data
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("Preview failed")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/visualize")
async def visualize_dataset(request: VisualizeRequest):
    """Returns data formatted for specific charts (scatter, histogram, bar, etc)."""
    try:
        data = get_chart_data(request.filename, request.x_axis, request.y_axis, request.chart_type)
        return data
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Visualization failed")
        raise HTTPException(status_code=500, detail=str(e))
