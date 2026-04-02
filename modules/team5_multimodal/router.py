"""
router.py  –  MANDATORY router for Team 5 (Multimodal).
Contains only API endpoints; business logic lives in services.py.
"""

import logging
import os

from fastapi import APIRouter, HTTPException, UploadFile, File

from modules.team5_multimodal.models import (
    TextAnalysisResponse, CodeAnalysisResponse, ImageAnalysisResponse
)
from modules.team5_multimodal.services import TextAnalysisService
from modules.team5_multimodal.code_analysis_service import CodeAnalysisService
from modules.team5_multimodal.image_services import ImageAnalysisService

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


@router.post("/code-analyze", response_model=CodeAnalysisResponse)
async def analyze_code(file: UploadFile = File(...)):
    """Accept a ZIP file of a codebase and perform 2-pass LLM analysis."""
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only ZIP files are supported.")

    zip_bytes = await file.read()
    if not zip_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    service = CodeAnalysisService()

    try:
        # 1. Extract ZIP
        root_dir = service.extract_zip(zip_bytes)
        
        # 2. Build file tree
        file_tree = service.build_file_tree(root_dir)
        
        # 3. Pass 1: Architecture
        arch_result = await service.analyze_architecture(file_tree)
        
        # 4. Pass 2: Detailed analysis
        code_snippets = service.select_important_files(root_dir)
        detail_result = await service.analyze_files(arch_result, code_snippets)
        
        # Count files (approximate for the response)
        file_count = 0
        for _, _, files in os.walk(root_dir):
            file_count += len(files)

        return CodeAnalysisResponse(
            filename=file.filename,
            file_count=file_count,
            architecture=arch_result,
            details=detail_result
        )

    except Exception as exc:
        logger.exception("Code analysis failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/image-analyze", response_model=ImageAnalysisResponse)
async def analyze_images(file: UploadFile = File(...)):
    """Accept a ZIP file of images and perform clustering and object detection."""
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only ZIP files are supported.")

    zip_bytes = await file.read()
    if not zip_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    service = ImageAnalysisService()

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
