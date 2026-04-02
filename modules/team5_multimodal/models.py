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


# ──────────────────────────────────────────────
#  Code Analysis Models
# ──────────────────────────────────────────────

class Component(BaseModel):
    id: str
    name: str
    type: str  # frontend | backend | api | database | service | config | other
    description: str
    files: list[str]


class Connection(BaseModel):
    source: str  # component id
    target: str  # component id
    type: str  # import | api_call | data_flow | config
    description: str


class CodeArchResult(BaseModel):
    title: str
    summary: str
    components: list[Component]
    connections: list[Connection]


class KeyFile(BaseModel):
    file_path: str
    summary: str
    key_functions: list[str]


class FlowStep(BaseModel):
    step: int
    description: str


class CodeDetailResult(BaseModel):
    key_files: list[KeyFile]
    flow: list[FlowStep]


class CodeAnalysisResponse(BaseModel):
    status: str = "success"
    filename: str
    file_count: int
    architecture: CodeArchResult
    details: CodeDetailResult


# ──────────────────────────────────────────────
#  Image Analysis Models (Teammate's Version)
# ──────────────────────────────────────────────

class DetectionBox(BaseModel):
    label: str
    confidence: float
    box: list[float]  # [x1, y1, x2, y2]


class ImageAnalysisResult(BaseModel):
    filename: str
    caption: str
    detections: list[DetectionBox]


class ProjectionPoint(BaseModel):
    x: float
    y: float
    cluster: int
    filename: str


class ClusterInfo(BaseModel):
    cluster_id: int
    description: str
    count: int


class MultiImageAnalysisResponse(BaseModel):
    status: str = "success"
    results: list[ImageAnalysisResult]
    projection: list[ProjectionPoint]
    clusters: list[ClusterInfo]


# ──────────────────────────────────────────────
#  Image Analysis Models (Multimodal ZIP Version)
#  NEW: Added by Team 5 to handle the output of the YOLO/CLIP/UMAP pipeline.
#  These models ensure the API response is strictly typed and documented for the FrontEnd.
# ──────────────────────────────────────────────

class DetectedObject(BaseModel):
    label: str
    confidence: float
    bbox: list[float]  # [x_min, y_min, x_max, y_max]

class ClusterPoint(BaseModel):
    filename: str
    cluster_id: int
    umap_x: float
    umap_y: float
    objects: list[DetectedObject]
    description: str | None = None

class ZipPipelineResult(BaseModel):
    clusters: list[ClusterPoint]
    plot_file_path: str

class ImageAnalysisResponse(BaseModel):
    status: str = "success"
    processed_count: int
    result: ZipPipelineResult
