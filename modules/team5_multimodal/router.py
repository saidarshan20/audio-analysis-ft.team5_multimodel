"""
router.py  –  MANDATORY router for Team 5 (Multimodal).
Contains only API endpoints; business logic lives in services.py.
"""

import logging
import os

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
import json
import asyncio

from modules.team5_multimodal.models import (
    TextAnalysisResponse, CodeAnalysisResponse, MultiImageAnalysisResponse, ImageAnalysisResponse
)
from modules.team5_multimodal.services import TextAnalysisService
from modules.team5_multimodal.code_analysis_service import CodeAnalysisService
from modules.team5_multimodal.image_analysis_service import ImageAnalysisService as TeammateImageAnalysisService
from modules.team5_multimodal.image_services import ImageAnalysisService as ZipImageAnalysisService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/team5", tags=["Team 5 - Multimodal"])

PDF_CONTENT_TYPES = {
    "application/pdf",
    "application/x-pdf",
}


@router.post("/analyze", response_model=TextAnalysisResponse)
async def analyze_text(file: UploadFile = File(...)):
    """Accept a .txt or .pdf file and return structured analysis."""
    raw_bytes = await file.read()

    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    service = TextAnalysisService()

    # Route: PDF → pdfplumber local extraction; otherwise treat as plain text
    if file.content_type in PDF_CONTENT_TYPES or (
        file.filename and file.filename.lower().endswith(".pdf")
    ):
        text = service.extract_pdf_text(raw_bytes)
        if not text.strip():
            raise HTTPException(
                status_code=422,
                detail="Could not extract text from the PDF.",
            )
    else:
        text = raw_bytes.decode("utf-8", errors="replace")

    try:
        result = await service.analyze(text)
    except Exception as exc:
        logger.exception("Analysis failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return TextAnalysisResponse(
        filename=file.filename or "unknown",
        content_type=file.content_type or "application/octet-stream",
        result=result,
    )

from pydantic import BaseModel

class GithubAnalysisRequest(BaseModel):
    repo_url: str


@router.post("/code-analyze")
async def analyze_code(file: UploadFile = File(...)):
    """Accept a ZIP file of a codebase and perform 2-pass LLM analysis via stream."""
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only ZIP files are supported.")

    zip_bytes = await file.read()
    service = CodeAnalysisService()

    async def event_generator():
        try:
            yield json.dumps({"type": "progress", "step": "extracting", "message": "Extracting ZIP archive..."}) + "\n"
            root_dir = service.extract_zip(zip_bytes)
            
            async for update in service.analyze_repo_stream(root_dir, file.filename):
                yield json.dumps(update) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")

@router.post("/code-analyze/github")
async def analyze_code_github(payload: GithubAnalysisRequest):
    """Clone a GitHub repository and perform 2-pass LLM analysis via stream."""
    service = CodeAnalysisService()

    async def event_generator():
        try:
            yield json.dumps({"type": "progress", "step": "cloning", "message": f"Cloning {payload.repo_url}..."}) + "\n"
            root_dir = service.clone_github_repo(payload.repo_url)
            
            repo_name = payload.repo_url.rstrip('/').split('/')[-1]
            async for update in service.analyze_repo_stream(root_dir, repo_name):
                yield json.dumps(update) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


@router.post("/analyze-images", response_model=MultiImageAnalysisResponse)
async def analyze_images_teammate(files: list[UploadFile] = File(...)):
    """Accept multiple images and return object detection, captions, and UMAP clusters."""
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    service = TeammateImageAnalysisService()
    results = []
    embeddings = []
    filenames = []

    try:
        for file in files:
            # Basic type check
            if not file.content_type.startswith("image/"):
                logger.warning("Skipping non-image file: %s", file.filename)
                continue

            raw_bytes = await file.read()
            if not raw_bytes:
                continue

            # Run detection, captioning, embedding
            res, embed = service.analyze_image(raw_bytes, file.filename or "unknown")
            results.append(res)
            embeddings.append(embed)
            filenames.append(file.filename or "unknown")

        # Perform clustering and 2D projection
        projection, clusters = service.perform_clustering(embeddings, filenames)

        return MultiImageAnalysisResponse(
            results=results,
            projection=projection,
            clusters=clusters
        )

    except Exception as exc:
        logger.exception("Image analysis failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ──────────────────────────────────────────────
#  NEW INTEGRATION: Multimodal Image Analysis Pipeline
#  Added image processing endpoint bridging YOLO, CLIP, and UMAP.
# ──────────────────────────────────────────────
@router.post("/image-analyze-zip", response_model=ImageAnalysisResponse)
async def analyze_images_zip(file: UploadFile = File(...)):
    """
    Accepts a ZIP file containing raw images and processes them via the ImageAnalysisService.
    - YOLOv8 extracts bounding boxes.
    - OpenAI CLIP generates semantic embeddings.
    - Scikit-Learn KMeans clusters the embeddings.
    - UMAP reduces dimensions for 2D graphing.
    - Matplotlib generates a final scatter plot in the shared_workspace.
    """
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only ZIP files are supported.")

    zip_bytes = await file.read()
    if not zip_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    service = ZipImageAnalysisService()

    try:
        # Extract images from ZIP
        extract_dir = service.extract_zip(zip_bytes)
        
        # Run ML Pipeline
        analysis_result = service.process_images(extract_dir)

        return ImageAnalysisResponse(
            filename=file.filename,
            processed_count=len(analysis_result.clusters),
            result=analysis_result
        )

    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))
    except Exception as exc:
        logger.exception("Image analysis pipeline failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
