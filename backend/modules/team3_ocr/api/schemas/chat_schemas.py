"""
Pydantic schemas for Document Chat (RAG) API.
"""

from pydantic import BaseModel, Field
from typing import Optional, List


class ChatMessage(BaseModel):
    role: str = Field(..., description="'user' or 'assistant'")
    content: str


class ChatRequest(BaseModel):
    document_id: Optional[str] = None
    document_ids: Optional[List[str]] = None
    question: str
    history: List[ChatMessage] = Field(default_factory=list)


class ChatSource(BaseModel):
    text_snippet: str
    score: float


class ChatResponse(BaseModel):
    answer: str
    sources: List[ChatSource] = []
