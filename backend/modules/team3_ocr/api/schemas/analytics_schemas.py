"""
Pydantic schemas for Text Analytics API requests and responses.
"""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


# ===== Request Schemas =====

class CustomEntity(BaseModel):
    label: str
    keywords: List[str]


class AnalyzeRequest(BaseModel):
    """Full analysis request — provide either text or document_id."""
    text: Optional[str] = Field(default=None, description="Direct text to analyze")
    document_id: Optional[str] = Field(default=None, description="ID of a previously OCR'd document")
    analyses: List[str] = Field(
        default=["sentiment", "ner", "keyphrases", "language", "intent"],
        description="Which analyses to run (add risk, insights, structured_entities)",
    )
    custom_entities: Optional[List[CustomEntity]] = Field(default=None, description="Definitions for custom NER extraction")


class SentimentRequest(BaseModel):
    text: str


class EntitiesRequest(BaseModel):
    text: str
    custom_entities: Optional[List[CustomEntity]] = None


class KeyphrasesRequest(BaseModel):
    text: str


class LanguageRequest(BaseModel):
    text: str


class IntentRequest(BaseModel):
    text: str


class SummarizeRequest(BaseModel):
    text: str
    max_length: int = Field(default=150, ge=50, le=1000)


class EntityUpdateRequest(BaseModel):
    """For editing a detected entity."""
    text: Optional[str] = None
    entity_type: Optional[str] = None


# ===== Response Schemas =====

class SentimentResult(BaseModel):
    overall: str  # positive, negative, neutral
    score: float
    per_sentence: List[dict] = []


class EntityResult(BaseModel):
    id: str
    text: str
    entity_type: str
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None
    confidence: Optional[float] = None
    is_user_edited: bool = False


class LanguageResult(BaseModel):
    code: str
    name: str
    confidence: float


class IntentResult(BaseModel):
    primary: str
    confidence: float


class RiskFlag(BaseModel):
    category: str  # e.g., missing_field, suspicious_value, compliance_flag
    severity: str  # high, medium, low
    message: str
    confidence: float


class ActionItem(BaseModel):
    task: str
    assignee: Optional[str] = None
    due_date: Optional[str] = None
    status: str = "pending"


class InsightsResult(BaseModel):
    summary: str
    takeaways: List[str] = []
    action_items: List[ActionItem] = []


class StructuredEntities(BaseModel):
    people: List[str] = []
    organizations: List[str] = []
    locations: List[str] = []
    dates: List[str] = []
    amounts: List[str] = []
    relationships: List[str] = []


class FullAnalysisResponse(BaseModel):
    document_id: Optional[str] = None
    sentiment: Optional[SentimentResult] = None
    entities: List[EntityResult] = []
    keyphrases: List[str] = []
    language: Optional[LanguageResult] = None
    intent: Optional[IntentResult] = None
    summary: Optional[str] = None
    insights: Optional[InsightsResult] = None
    risk_flags: List[RiskFlag] = []
    structured_entities: Optional[StructuredEntities] = None
