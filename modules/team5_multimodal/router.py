"""
router.py  –  MANDATORY router for Team 5 (Multimodal).
Contains only API endpoints; business logic lives in services.py.

Updated: Added 2 new endpoints for Image Q&A and Advanced Search.
"""

import logging
import os

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
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
    """Accept multiple images. Now with smart cluster naming via Groq."""
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    service = TeammateImageAnalysisService()
    results = []
    embeddings = []
    filenames = []

    try:
        for file in files:
            if not file.content_type.startswith("image/"):
                logger.warning("Skipping non-image file: %s", file.filename)
                continue

            raw_bytes = await file.read()
            if not raw_bytes:
                continue

            res, embed = service.analyze_image(raw_bytes, file.filename or "unknown")
            results.append(res)
            embeddings.append(embed)
            filenames.append(file.filename or "unknown")

        # Pass results for smart cluster naming (Point 1)
        projection, clusters = service.perform_clustering(embeddings, filenames, results=results)

        return MultiImageAnalysisResponse(
            results=results,
            projection=projection,
            clusters=clusters
        )

    except Exception as exc:
        logger.exception("Image analysis failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/image-analyze-zip", response_model=ImageAnalysisResponse)
async def analyze_images_zip(file: UploadFile = File(...)):
    """Accepts a ZIP file containing raw images and processes them."""
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only ZIP files are supported.")

    zip_bytes = await file.read()
    if not zip_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    service = ZipImageAnalysisService()

    try:
        extract_dir = service.extract_zip(zip_bytes)
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


# ──────────────────────────────────────────────
#  NEW ENDPOINTS (Groq-powered)
# ──────────────────────────────────────────────

@router.post("/image-ask")
async def ask_about_image(
    file: UploadFile = File(...),
    question: str = Form(...)
):
    """
    Point 2 - Contextual Image Q&A:
    Upload an image + ask any question. Groq Vision answers intelligently.
    """
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are accepted.")

    if not question or not question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded image is empty.")

    service = TeammateImageAnalysisService()

    try:
        answer = service.ask_about_image(image_bytes, question.strip())
        return {
            "status": "success",
            "filename": file.filename,
            "question": question.strip(),
            "answer": answer
        }
    except Exception as exc:
        logger.exception("Image Q&A failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class ImageSearchRequest(BaseModel):
    query: str
    captions: list[dict]


@router.post("/image-search")
async def search_images(payload: ImageSearchRequest):
    """
    Point 3 - Advanced Search Intelligence:
    Search images using complex natural language queries powered by Groq.
    """
    if not payload.query or not payload.query.strip():
        raise HTTPException(status_code=400, detail="Search query cannot be empty.")

    if not payload.captions:
        raise HTTPException(status_code=400, detail="No image captions provided.")

    service = TeammateImageAnalysisService()

    try:
        ranked_results = service.search_images(payload.query.strip(), payload.captions)
        return {
            "status": "success",
            "query": payload.query.strip(),
            "total_searched": len(payload.captions),
            "results": ranked_results
        }
    except Exception as exc:
        logger.exception("Image search failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
