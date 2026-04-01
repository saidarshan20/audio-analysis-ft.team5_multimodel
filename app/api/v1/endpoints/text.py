import logging

from fastapi import APIRouter, HTTPException, UploadFile, File

from app.models.text_models import TextAnalysisResponse
from app.services.text_service import TextAnalysisService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/text", tags=["Text Analysis"])

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

    # Route: PDF → Document Intelligence → text; otherwise treat as plain text
    if file.content_type in PDF_CONTENT_TYPES or (
        file.filename and file.filename.lower().endswith(".pdf")
    ):
        text = await service.extract_pdf_text(raw_bytes)
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
