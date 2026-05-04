"""
Pydantic schemas for Semantic Search API.
"""

from pydantic import BaseModel, Field
from typing import Optional, List


class IndexRequest(BaseModel):
    document_id: str


class SearchQuery(BaseModel):
    query: str
    top_k: int = Field(default=5, ge=1, le=50)


class SearchResult(BaseModel):
    document_id: str
    filename: str
    text_snippet: str
    highlight: str = ""
    score: float
    page_number: Optional[int] = None
    document_type: Optional[str] = None
    page_count: Optional[int] = None


class SearchResponse(BaseModel):
    query: str
    results: List[SearchResult] = []
    total_results: int = 0
