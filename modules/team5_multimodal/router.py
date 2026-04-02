"""
router.py  –  MANDATORY router for Team 5 (Multimodal).
Contains only API endpoints; business logic lives in services.py.
"""

import logging
import os

from fastapi import APIRouter, HTTPException, UploadFile, File

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
        
        # 2. Build AST JSON graph
        graph_data = service.build_code_graph(root_dir)
        
        # 3. Pass 1: Architecture
        arch_result = await service.analyze_architecture(graph_data)
        
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

@router.post("/code-analyze/github", response_model=CodeAnalysisResponse)
async def analyze_code_github(payload: GithubAnalysisRequest):
    """Clone a GitHub repository and perform 2-pass LLM analysis."""
    service = CodeAnalysisService()

    try:
        # 1. Clone Repo
        root_dir = service.clone_github_repo(payload.repo_url)
        
        # 2. Build AST JSON graph
        graph_data = service.build_code_graph(root_dir)
        
        # 3. Pass 1: Architecture
        arch_result = await service.analyze_architecture(graph_data)
        
        # 4. Pass 2: Detailed analysis
        code_snippets = service.select_important_files(root_dir)
        detail_result = await service.analyze_files(arch_result, code_snippets)
        
        # Count files (approximate for the response)
        file_count = 0
        for _, _, files in os.walk(root_dir):
            file_count += len(files)

        repo_name = payload.repo_url.rstrip('/').split('/')[-1]

        return CodeAnalysisResponse(
            filename=f"{repo_name} (GitHub)",
            file_count=file_count,
            architecture=arch_result,
            details=detail_result
        )

    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))
    except Exception as exc:
        logger.exception("GitHub code analysis failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


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
@router.post("/image-analyze", response_model=ImageAnalysisResponse)
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
