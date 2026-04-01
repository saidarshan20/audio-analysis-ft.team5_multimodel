"""
models.py  –  Pydantic schemas for Team 5 Multimodal text & PDF analysis.
Migrated from app/models/text_models.py.
"""

from pydantic import BaseModel, Field


class Sentiment(BaseModel):
    positive: float = Field(ge=0, le=1)
    negative: float = Field(ge=0, le=1)
    neutral: float = Field(ge=0, le=1)
    overall_label: str  # "positive" | "negative" | "neutral" | "mixed"


class KGNode(BaseModel):
    id: str
    label: str
    type: str  # "Person" | "Place" | "Organization" | "Event" | "Concept"


class KGEdge(BaseModel):
    source: str  # KGNode.id
    target: str  # KGNode.id
    relation: str


class TimelineEvent(BaseModel):
    date: str  # ISO-8601 or descriptive (e.g. "March 2024")
    description: str


class GeoLocation(BaseModel):
    name: str
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class TextAnalysisResult(BaseModel):
    summary: str
    sentiment: Sentiment
    entities: list[KGNode]
    kg_nodes: list[KGNode]
    kg_edges: list[KGEdge]
    timeline: list[TimelineEvent]
    locations: list[GeoLocation]


class TextAnalysisResponse(BaseModel):
    status: str = "success"
    filename: str
    content_type: str
    result: TextAnalysisResult
