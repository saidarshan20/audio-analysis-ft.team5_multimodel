"""
Pydantic schemas for OCR API requests and responses.
"""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum


# ===== Enums =====

class OCRModelChoice(str, Enum):
    AUTO = "auto"
    TESSERACT = "tesseract"
    EASYOCR = "easyocr"
    AZURE_DI = "azure_di"


class TaskType(str, Enum):
    TEXT = "text"
    TABLE = "table"
    BOTH = "both"


class JobStatusEnum(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


# ===== Request Schemas =====

class OCRUploadRequest(BaseModel):
    """Metadata sent along with file upload (form fields)."""
    ocr_model: OCRModelChoice = OCRModelChoice.AUTO
    priority: str = Field(default="normal", pattern="^(normal|high)$")
    task_type: TaskType = TaskType.BOTH
    language_hint: str = Field(default="auto", description="ISO language code or 'auto'")


# ===== Response Schemas =====

class TableData(BaseModel):
    rows: List[List[str]]
    confidence: Optional[float] = None


class PageResult(BaseModel):
    page_number: int
    text: str = ""
    tables: List[TableData] = []
    confidence: Optional[float] = None


class AIInsights(BaseModel):
    summary: Optional[str] = None
    quality_score: Optional[float] = None
    entities: List[dict] = []
    language: Optional[dict] = None
    model_used: str = ""


class DocumentResult(BaseModel):
    id: str
    filename: str
    page_count: int
    pages: List[PageResult] = []


class OCRResultResponse(BaseModel):
    job_id: str
    status: JobStatusEnum
    document: Optional[DocumentResult] = None
    ai_insights: Optional[AIInsights] = None


class JobStatusResponse(BaseModel):
    job_id: str
    status: JobStatusEnum
    progress: int = 0
    error_message: Optional[str] = None
    created_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class DocumentListItem(BaseModel):
    id: str
    filename: str
    document_type: str
    page_count: int
    file_size: int
    created_at: datetime


class DocumentListResponse(BaseModel):
    documents: List[DocumentListItem]
    total: int

# ===== Session Schemas =====

class OcrSession(BaseModel):
    id: str
    name: str
    timestamp: int
    allResults: List[dict]
    chatHistories: Optional[dict] = None
    expandedSources: Optional[dict] = None
    aiInsightsCache: Optional[dict] = None

class SessionListItem(BaseModel):
    id: str
    name: str
    timestamp: int

class SessionListResponse(BaseModel):
    sessions: List[SessionListItem]
