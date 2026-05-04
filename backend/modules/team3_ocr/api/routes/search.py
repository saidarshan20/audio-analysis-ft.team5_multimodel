"""
Semantic Search endpoints — index documents, search across them.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from modules.team3_ocr.api.dependencies import verify_auth, get_search_provider
from modules.team3_ocr.api.schemas.search_schemas import IndexRequest, SearchQuery, SearchResponse, SearchResult
from modules.team3_ocr.models.database import get_db
from modules.team3_ocr.models.document import Document, OCRResult

router = APIRouter(prefix="/search", tags=["Team 3 - OCR"], dependencies=[Depends(verify_auth)])


@router.post("/index")
async def index_document(request: IndexRequest, db: AsyncSession = Depends(get_db)):
    """Index a processed document for semantic search."""
    doc = await db.get(Document, request.document_id)
    if not doc:
        raise HTTPException(404, "Document not found")

    # Get extracted text
    results = (await db.execute(
        select(OCRResult).where(OCRResult.document_id == request.document_id)
        .order_by(OCRResult.page_number)
    )).scalars().all()

    if not results:
        raise HTTPException(400, "No OCR results found. Process the document first.")

    full_text = "\n".join(r.extracted_text or "" for r in results)
    if not full_text.strip():
        raise HTTPException(400, "No text content to index.")

    search = get_search_provider()
    success = await search.index_document(
        doc_id=doc.id,
        text=full_text,
        metadata={
            "filename": doc.original_filename,
            "document_type": doc.document_type,
            "page_count": doc.page_count,
        },
    )

    if success:
        return {"success": True, "message": f"Document {doc.id} indexed successfully"}
    else:
        raise HTTPException(500, "Failed to index document")


@router.post("/query", response_model=SearchResponse)
async def search_documents(request: SearchQuery):
    """Search across all indexed documents using semantic similarity."""
    search = get_search_provider()
    results = await search.search(request.query, top_k=request.top_k)

    return SearchResponse(
        query=request.query,
        results=[SearchResult(
            document_id=r["doc_id"],
            filename=r.get("metadata", {}).get("filename", "unknown"),
            text_snippet=r["text_snippet"][:500],
            highlight=r.get("highlight", r["text_snippet"][:160]),
            score=r["score"],
            page_number=r.get("page_number"),
            document_type=r.get("metadata", {}).get("document_type"),
            page_count=r.get("metadata", {}).get("page_count"),
        ) for r in results],
        total_results=len(results),
    )


@router.delete("/index/{doc_id}")
async def remove_from_index(doc_id: str):
    """Remove a document from the search index."""
    search = get_search_provider()
    success = await search.remove_document(doc_id)

    if success:
        return {"success": True, "message": f"Document {doc_id} removed from index"}
    else:
        raise HTTPException(404, "Document not found in index")
