"""
Pydantic schemas for Visualization API.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Literal


class WordCloudRequest(BaseModel):
    text: Optional[str] = None
    document_id: Optional[str] = None
    max_words: int = Field(default=200, ge=10, le=500)
    width: int = Field(default=800, ge=200, le=2000)
    height: int = Field(default=400, ge=200, le=1000)


class FrequencyRequest(BaseModel):
    text: Optional[str] = None
    document_id: Optional[str] = None
    top_n: int = Field(default=20, ge=5, le=100)


class LinguisticRequest(BaseModel):
    text: Optional[str] = None
    document_id: Optional[str] = None

class KnowledgeGraphRequest(BaseModel):
    relationships: List[str] = []
    engine: Literal["networkx", "graphrag", "hybrid"] = "hybrid"


class WordFrequencyItem(BaseModel):
    text: str
    frequency: int


class WordCloudResponse(BaseModel):
    image_url: str
    image_base64: Optional[str] = None
    data: List[WordFrequencyItem] = []


class FrequencyResponse(BaseModel):
    image_url: Optional[str] = None
    data: List[WordFrequencyItem] = []


class LinguisticResponse(BaseModel):
    pos_distribution: dict = {}  # Part-of-speech tag distribution
    image_url: Optional[str] = None
    image_base64: Optional[str] = None
    language_code: Optional[str] = None
    error_message: Optional[str] = None


class KnowledgeGraphResponse(BaseModel):
    image_url: Optional[str] = None
    image_base64: Optional[str] = None
    node_count: int = 0
    edge_count: int = 0
    engine_used: Optional[str] = None
    error_message: Optional[str] = None
