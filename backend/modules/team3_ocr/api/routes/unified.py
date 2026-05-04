"""
Unified (dynamic) endpoints for Team 3.

Goal: reduce the number of distinct URLs exposed in Swagger while keeping
all underlying functionality available via the existing detailed endpoints.
"""

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from modules.team3_ocr.api.dependencies import verify_auth
from modules.team3_ocr.models.database import get_db

# Delegate to existing implementations
from modules.team3_ocr.api.routes.visualization import (
    generate_wordcloud,
    word_frequency,
    linguistic_analysis,
    knowledge_graph,
)
from modules.team3_ocr.api.schemas.visualization_schemas import (
    WordCloudRequest,
    FrequencyRequest,
    LinguisticRequest,
    KnowledgeGraphRequest,
)
from modules.team3_ocr.api.routes.search import (
    index_document,
    search_documents,
    remove_from_index,
)
from modules.team3_ocr.api.schemas.search_schemas import IndexRequest, SearchQuery


router = APIRouter(prefix="/unified", tags=["Team 3 - OCR"], dependencies=[Depends(verify_auth)])


class UnifiedVizRequest(BaseModel):
    type: Literal["wordcloud", "frequency", "linguistic", "knowledge-graph"]
    payload: dict[str, Any] = Field(default_factory=dict)


@router.post("/viz")
async def viz(request: UnifiedVizRequest, db: AsyncSession = Depends(get_db)):
    if request.type == "wordcloud":
        return await generate_wordcloud(WordCloudRequest(**request.payload), db)
    if request.type == "frequency":
        return await word_frequency(FrequencyRequest(**request.payload), db)
    if request.type == "linguistic":
        return await linguistic_analysis(LinguisticRequest(**request.payload), db)
    if request.type == "knowledge-graph":
        return await knowledge_graph(KnowledgeGraphRequest(**request.payload))
    raise HTTPException(400, "Unknown visualization type")


class UnifiedSearchRequest(BaseModel):
    action: Literal["index", "query"]
    payload: dict[str, Any] = Field(default_factory=dict)


@router.post("/search")
async def search(request: UnifiedSearchRequest, db: AsyncSession = Depends(get_db)):
    if request.action == "index":
        return await index_document(IndexRequest(**request.payload), db)
    if request.action == "query":
        return await search_documents(SearchQuery(**request.payload))
    raise HTTPException(400, "Unknown search action")


@router.delete("/search/{doc_id}")
async def search_remove(doc_id: str):
    return await remove_from_index(doc_id)

