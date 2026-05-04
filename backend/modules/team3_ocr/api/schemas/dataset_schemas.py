"""
Pydantic schemas for Dataset Extraction API.
Used by the "Data Harvester" feature to extract structured rows
from documents based on a user-provided dataset schema.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict


# ===== Request Schemas =====

class SchemaColumn(BaseModel):
    """A single column definition from the user's dataset."""
    name: str = Field(..., description="Column header name")
    description: Optional[str] = Field(default=None, description="Optional hint for better semantic search")
    sample_values: Optional[List[str]] = Field(default=None, description="First few values from the dataset for context")


class DatasetExtractRequest(BaseModel):
    """Request to extract dataset rows from a processed document."""
    document_id: str = Field(..., description="ID of the processed/indexed document")
    schema: List[SchemaColumn] = Field(..., description="Dataset columns to extract values for")
    filename: Optional[str] = Field(default=None, description="Document filename for additional context")


# ===== Response Schemas =====

class DatasetExtractResponse(BaseModel):
    """Response containing extracted row(s) of data."""
    rows: List[Dict[str, Optional[str]]] = Field(
        default_factory=list,
        description="List of extracted rows; each row is a dict of column_name → extracted value",
    )
    chunks_used: int = Field(default=0, description="Number of document chunks sent to AI")
    message: Optional[str] = Field(default=None, description="Status or error message")

    # Debug-only helpers (frontends can ignore)
    raw_model_response: Optional[str] = Field(default=None, description="Raw model output (debug)")
    chunks_preview: Optional[List[Dict[str, Optional[str]]]] = Field(
        default=None,
        description="Small preview of chunks sent to the model (debug)",
    )
