"""
OCR endpoints — upload documents, poll job status, get results.
"""

import uuid
import re
import shutil
from pathlib import Path
from datetime import datetime, timezone
from html.parser import HTMLParser
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from modules.team3_ocr.config import settings
from modules.team3_ocr.api.dependencies import verify_auth, get_ocr_provider, get_nlp_provider, get_blob_storage
from modules.team3_ocr.api.schemas.ocr_schemas import (
    OCRModelChoice, TaskType, JobStatusEnum,
    JobStatusResponse, OCRResultResponse, DocumentResult, PageResult, TableData,
    AIInsights, DocumentListItem, DocumentListResponse,
)
from modules.team3_ocr.models.database import get_db
from modules.team3_ocr.models.document import Document, ProcessingJob, OCRResult, Entity
from modules.team3_ocr.storage import BlobPaths

router = APIRouter(prefix="/ocr", tags=["Team 3 - OCR"], dependencies=[Depends(verify_auth)])


def _get_mime_type(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    mime_map = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".tiff": "image/tiff",
        ".bmp": "image/bmp",
        ".webp": "image/webp",
    }
    return mime_map.get(ext, "application/octet-stream")


def _get_doc_type(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        return "pdf"
    elif ext in [".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".webp"]:
        return "image"
    return "unknown"


def _html_tables_to_ascii(text: str) -> str:
    """Convert any <table>...</table> HTML blocks in text to ASCII grid tables."""
    # Quick check — avoid overhead if there are no HTML tables
    if "<table" not in text.lower():
        return text

    class _TableParser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.rows = []
            self._current_row = []
            self._current_cell = ""
            self._in_cell = False

        def handle_starttag(self, tag, attrs):
            if tag in ("td", "th"):
                self._in_cell = True
                self._current_cell = ""
            elif tag == "tr":
                self._current_row = []

        def handle_endtag(self, tag):
            if tag in ("td", "th"):
                self._in_cell = False
                self._current_row.append(self._current_cell.strip())
            elif tag == "tr":
                if self._current_row:
                    self.rows.append(self._current_row)

        def handle_data(self, data):
            if self._in_cell:
                self._current_cell += data

    def _rows_to_ascii(rows):
        if not rows:
            return ""
        # Normalise column count
        num_cols = max(len(r) for r in rows)
        for r in rows:
            while len(r) < num_cols:
                r.append("")
        # Calculate column widths
        col_widths = [0] * num_cols
        for row in rows:
            for i, cell in enumerate(row):
                col_widths[i] = max(col_widths[i], len(cell))
        # Ensure minimum width
        col_widths = [max(w, 3) for w in col_widths]
        # Build grid
        sep = "+" + "+".join(["-" * (w + 2) for w in col_widths]) + "+"
        lines = ["\n[TABLE START]", "```text", sep]
        for i, row in enumerate(rows):
            formatted = "| " + " | ".join(
                cell.ljust(col_widths[idx]) for idx, cell in enumerate(row)
            ) + " |"
            lines.append(formatted)
            if i == 0 or i == len(rows) - 1:
                lines.append(sep)
        lines.append("```")
        lines.append("[TABLE END]\n")
        return "\n".join(lines)

    # Find and replace all <table>...</table> blocks
    pattern = re.compile(r"<table[^>]*>.*?</table>", re.DOTALL | re.IGNORECASE)
    def _replace_match(m):
        parser = _TableParser()
        parser.feed(m.group(0))
        return _rows_to_ascii(parser.rows)

    return pattern.sub(_replace_match, text)


async def _process_ocr(job_id: str, doc_id: str, file_path: str, task_type: str, language: str):
    """Background task to run OCR processing."""
    from modules.team3_ocr.models.database import async_session

    async with async_session() as db:
        try:
            # Update job status to processing
            job = await db.get(ProcessingJob, job_id)
            if job:
                job.status = JobStatusEnum.PROCESSING.value
                job.progress = 10
                await db.commit()

            ocr_provider = get_ocr_provider()
            nlp_provider = get_nlp_provider()
            fp = Path(file_path)
            blob_paths = BlobPaths()
            blob_client = get_blob_storage()
            processed_pages_for_export = []

            # Step 1: Extract text
            text_result = await ocr_provider.extract_text(fp, language)
            if job:
                job.progress = 40
                job.ocr_model_used = text_result.get("model_used", "unknown")
                await db.commit()

            # Step 2: Extract tables (if requested)
            tables_result = []
            if task_type in ["table", "both"]:
                tables_result = await ocr_provider.extract_tables(fp)
                if job:
                    job.progress = 60
                    await db.commit()

            # Step 3: Save OCR results per page
            all_text = ""
            for page in text_result.get("pages", []):
                page_tables = [t for t in tables_result if t.get("page_number") == page["page_number"]]
                
                page_text = page.get("text", "")
                
                # Append tables to text in professional ASCII grid format
                model_used = text_result.get("model_used", "").lower()
                if page_tables and "azure" not in model_used:
                    for t in page_tables:
                        rows = t.get("rows", [])
                        if not rows or len(rows) < 1:
                            continue

                        # Generate professional ASCII Box Table
                        try:
                            # 1. Calculate max width for each column
                            num_cols = len(rows[0])
                            col_widths = [0] * num_cols
                            for row in rows:
                                for i, cell in enumerate(row):
                                    cell_val = str(cell) if cell is not None else ""
                                    col_widths[i] = max(col_widths[i], len(cell_val))

                            # 2. Build the grid parts
                            sep = "+" + "+".join(["-" * (w + 2) for w in col_widths]) + "+"
                            
                            # Wrap in code block so markdown preserves alignment
                            ascii_table = "\n\n[TABLE START]\n```text\n" + sep + "\n"
                            for i, row in enumerate(rows):
                                formatted_row = "| " + " | ".join([
                                    (str(cell) if cell is not None else "").ljust(col_widths[idx])
                                    for idx, cell in enumerate(row)
                                ]) + " |"
                                ascii_table += formatted_row + "\n"
                                
                                # Add separator after header or between rows
                                if i == 0 or i == len(rows) - 1:
                                    ascii_table += sep + "\n"
                            
                            ascii_table += "```\n[TABLE END]\n"
                            page_text += ascii_table + "\n"
                        except Exception as te:
                            # fallback to basic if math fails
                            page_text += "\n[Table Data Available]\n"

                # Convert any remaining HTML <table> blocks to ASCII grids
                page_text = _html_tables_to_ascii(page_text)

                ocr_result = OCRResult(
                    document_id=doc_id,
                    page_number=page["page_number"],
                    extracted_text=page_text,
                    tables_json=page_tables if page_tables else None,
                    confidence=page.get("confidence"),
                )
                db.add(ocr_result)
                processed_pages_for_export.append({
                    "page_number": page["page_number"],
                    "text": page_text,
                    "confidence": page.get("confidence"),
                    "tables": page_tables if page_tables else [],
                })
                all_text += page_text + "\n"

            # Update page count
            doc = await db.get(Document, doc_id)
            if doc:
                doc.page_count = len(text_result.get("pages", []))

            if job:
                job.progress = 70
                await db.commit()

            # Step 4: Run NLP on extracted text for AI insights
            if all_text.strip():
                # Language detection
                lang_result = await nlp_provider.detect_language(all_text[:5000])

                # Entity extraction
                detected_lang = lang_result.get("code", "en")
                entities = await nlp_provider.extract_entities(all_text, detected_lang)

                # Save entities to DB
                for ent in entities:
                    entity = Entity(
                        document_id=doc_id,
                        text=ent["text"],
                        entity_type=ent["type"],
                        start_offset=ent.get("start"),
                        end_offset=ent.get("end"),
                        confidence=ent.get("confidence"),
                    )
                    db.add(entity)

                if job:
                    job.progress = 90
                    await db.commit()

            # Step 5: Index for semantic search over all modalities (text + tables included in text)
            try:
                from modules.team3_ocr.api.dependencies import get_search_provider
                search_provider = get_search_provider()
                doc_meta = await db.get(Document, doc_id)
                await search_provider.index_document(
                    doc_id=doc_id,
                    text=all_text,
                    metadata={
                        "filename": getattr(doc_meta, "original_filename", "unknown"),
                        "document_type": getattr(doc_meta, "document_type", "unknown"),
                        "page_count": getattr(doc_meta, "page_count", 0),
                    }
                )
                if job:
                    job.progress = 95
                    await db.commit()
            except Exception as se:
                import logging
                logging.getLogger(__name__).warning(f"Failed to auto-index document {doc_id}: {se}")

            # Mark job complete
            if job:
                job.status = JobStatusEnum.COMPLETED.value
                job.progress = 100
                job.completed_at = datetime.now(timezone.utc)
                await db.commit()

            # Export a compact artifact to Blob Storage for "processed outputs"
            if settings.storage_provider == "azure" and blob_client.is_available():
                try:
                    import json

                    doc = await db.get(Document, doc_id)
                    export = {
                        "document_id": doc_id,
                        "original_filename": getattr(doc, "original_filename", None),
                        "mime_type": getattr(doc, "mime_type", None),
                        "document_type": getattr(doc, "document_type", None),
                        "page_count": getattr(doc, "page_count", None),
                        "processed_at": datetime.now(timezone.utc).isoformat(),
                        "pages": processed_pages_for_export,
                    }
                    blob_client.upload_bytes(
                        blob_paths.processed_doc_json(doc_id),
                        json.dumps(export, ensure_ascii=False, indent=2).encode("utf-8"),
                        content_type="application/json",
                    )
                    blob_client.upload_bytes(
                        blob_paths.processed_doc_text(doc_id),
                        all_text.encode("utf-8"),
                        content_type="text/plain; charset=utf-8",
                    )
                except Exception:
                    pass

            # If Blob Storage is enabled and available, keep the source of truth in blob and clean up local temp file.
            if settings.storage_provider == "azure" and blob_client.is_available():
                try:
                    if fp.exists():
                        fp.unlink()
                except Exception:
                    pass

        except Exception as e:
            await db.rollback()  # Clear the failed transaction!
            if job:
                job.status = JobStatusEnum.FAILED.value
                job.error_message = str(e)
                await db.commit()


@router.post("/upload", response_model=JobStatusResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    ocr_model: OCRModelChoice = Form(default=OCRModelChoice.AUTO),
    task_type: TaskType = Form(default=TaskType.BOTH),
    language_hint: str = Form(default="auto"),
    db: AsyncSession = Depends(get_db),
):
    """Upload a PDF or image for OCR processing."""
    # Validate file type
    allowed_extensions = {".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".webp"}
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in allowed_extensions:
        raise HTTPException(400, f"Unsupported file type: {file_ext}. Allowed: {allowed_extensions}")

    # Validate file size
    content = await file.read()
    if len(content) > settings.max_file_size_bytes:
        raise HTTPException(413, f"File too large. Max size: {settings.max_file_size_mb}MB")

    # Save file to disk
    doc_id = str(uuid.uuid4())
    safe_filename = f"{doc_id}{file_ext}"
    upload_path = Path(settings.upload_dir) / safe_filename
    upload_path.parent.mkdir(parents=True, exist_ok=True)

    with open(upload_path, "wb") as f:
        f.write(content)

    # Upload the original file to Blob Storage (source-of-truth for Azure mode)
    if settings.storage_provider == "azure":
        blob_client = get_blob_storage()
        if blob_client.is_available():
            blob_paths = BlobPaths()
            blob_client.upload_bytes(
                blob_paths.upload_blob_name(safe_filename),
                content,
                content_type=_get_mime_type(file.filename),
            )

    # Create document record
    document = Document(
        id=doc_id,
        filename=safe_filename,
        original_filename=file.filename,
        file_path=str(upload_path),
        file_size=len(content),
        mime_type=_get_mime_type(file.filename),
        document_type=_get_doc_type(file.filename),
    )
    db.add(document)

    # Create processing job
    job = ProcessingJob(
        document_id=doc_id,
        job_type="ocr",
        status=JobStatusEnum.PENDING.value,
    )
    db.add(job)
    await db.commit()

    # Start background processing
    background_tasks.add_task(
        _process_ocr,
        job.id, doc_id, str(upload_path), task_type.value, language_hint,
    )

    return JobStatusResponse(
        job_id=job.id,
        status=JobStatusEnum.PENDING,
        progress=0,
        created_at=job.created_at,
    )


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str, db: AsyncSession = Depends(get_db)):
    """Poll the status of a processing job."""
    job = await db.get(ProcessingJob, job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    return JobStatusResponse(
        job_id=job.id,
        status=JobStatusEnum(job.status),
        progress=job.progress,
        error_message=job.error_message,
        created_at=job.created_at,
        completed_at=job.completed_at,
    )


@router.get("/jobs/{job_id}/result", response_model=OCRResultResponse)
async def get_job_result(job_id: str, db: AsyncSession = Depends(get_db)):
    """Get the full OCR result for a completed job."""
    job = await db.get(ProcessingJob, job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    if job.status != JobStatusEnum.COMPLETED.value:
        return OCRResultResponse(job_id=job.id, status=JobStatusEnum(job.status))

    # Fetch document and results
    doc = await db.get(Document, job.document_id)
    ocr_results = (await db.execute(
        select(OCRResult).where(OCRResult.document_id == job.document_id).order_by(OCRResult.page_number)
    )).scalars().all()

    entities = (await db.execute(
        select(Entity).where(Entity.document_id == job.document_id)
    )).scalars().all()

    # Build response
    pages = []
    for r in ocr_results:
        tables = []
        if r.tables_json:
            for t in r.tables_json:
                tables.append(TableData(rows=t.get("rows", []), confidence=t.get("confidence")))
        pages.append(PageResult(
            page_number=r.page_number,
            text=r.extracted_text or "",
            tables=tables,
            confidence=r.confidence,
        ))

    # Get NLP provider for language detection summary
    nlp = get_nlp_provider()
    full_text = " ".join(r.extracted_text or "" for r in ocr_results)

    lang_result = None
    summary = None
    if full_text.strip():
        lang_result = await nlp.detect_language(full_text[:5000])
        summary = await nlp.summarize(full_text[:10000])

    return OCRResultResponse(
        job_id=job.id,
        status=JobStatusEnum.COMPLETED,
        document=DocumentResult(
            id=doc.id,
            filename=doc.original_filename,
            page_count=doc.page_count,
            pages=pages,
        ),
        ai_insights=AIInsights(
            summary=summary,
            entities=[{
                "id": e.id, "text": e.text, "type": e.entity_type,
                "start": e.start_offset, "end": e.end_offset,
                "confidence": e.confidence, "is_user_edited": e.is_user_edited,
            } for e in entities],
            language=lang_result,
            model_used=job.ocr_model_used or "unknown",
        ),
    )


@router.get("/documents", response_model=DocumentListResponse)
async def list_documents(db: AsyncSession = Depends(get_db)):
    """List all processed documents."""
    result = await db.execute(select(Document).order_by(Document.created_at.desc()))
    docs = result.scalars().all()

    return DocumentListResponse(
        documents=[DocumentListItem(
            id=d.id, filename=d.original_filename, document_type=d.document_type,
            page_count=d.page_count, file_size=d.file_size, created_at=d.created_at,
        ) for d in docs],
        total=len(docs),
    )


@router.get("/documents/{doc_id}/file")
async def download_document_file(doc_id: str, db: AsyncSession = Depends(get_db)):
    """Download the original uploaded file (for frontend PDF rendering with pdf.js)."""
    from fastapi.responses import FileResponse

    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")

    if settings.storage_provider == "azure":
        blob_client = get_blob_storage()
        if blob_client.is_available():
            blob_paths = BlobPaths()
            blob_name = blob_paths.upload_blob_name(doc.filename)
            payload = blob_client.download_bytes(blob_name)
            if payload is None:
                raise HTTPException(404, "File not found in blob storage")
            return StreamingResponse(
                iter([payload]),
                media_type=doc.mime_type,
                headers={"Content-Disposition": f"attachment; filename=\"{doc.original_filename}\""},
            )

    file_path = Path(doc.file_path)
    if not file_path.exists():
        raise HTTPException(404, "File not found on disk")

    return FileResponse(
        path=str(file_path),
        media_type=doc.mime_type,
        filename=doc.original_filename,
    )


@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a document and all its associated data."""
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")

    # Delete file from disk
    file_path = Path(doc.file_path)
    if file_path.exists():
        file_path.unlink()

    # Delete from blob storage
    if settings.storage_provider == "azure":
        blob_client = get_blob_storage()
        if blob_client.is_available():
            blob_paths = BlobPaths()
            blob_client.delete(blob_paths.upload_blob_name(doc.filename))
            blob_client.delete(blob_paths.processed_doc_json(doc_id))
            blob_client.delete(blob_paths.processed_doc_text(doc_id))

    # Remove from search index
    try:
        search_provider = get_search_provider()
        await search_provider.remove_document(doc_id)
    except Exception:
        pass

    # Delete from database (cascades to jobs, ocr_results, entities)
    await db.delete(doc)
    await db.commit()

    return {"success": True, "message": f"Document {doc_id} deleted"}


# Import here to avoid circular import
from modules.team3_ocr.api.dependencies import get_search_provider
