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

class DiagramGroup(BaseModel):
    id: str
    label: str


class DiagramNode(BaseModel):
    id: str
    label: str
    type: str = ""
    description: str = ""
    group_id: str = ""
    path: str = ""
    shape: str = "box"  # box | database | queue | document | circle | hexagon


class DiagramEdge(BaseModel):
    source: str
    target: str
    label: str = ""
    style: str = "solid"  # solid | dashed


class CodeArchResult(BaseModel):
    title: str
    summary: str
    tech_stack: list[str] = Field(default_factory=list)
    detected_patterns: list[str] = Field(default_factory=list)
    groups: list[DiagramGroup] = Field(default_factory=list)
    nodes: list[DiagramNode] = Field(default_factory=list)
    edges: list[DiagramEdge] = Field(default_factory=list)


class KeyFile(BaseModel):
    file_path: str
    component: str = ""
    summary: str
    key_functions: list[str]


class FlowStep(BaseModel):
    step: int
    description: str


class CodeDetailResult(BaseModel):
    key_files: list[KeyFile]
    flow: list[FlowStep]
    tech_debt: list[str] = Field(default_factory=list)
    security_risks: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)


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
    annotated_image_path: str | None = None

class ZipPipelineResult(BaseModel):
    clusters: list[ClusterPoint]
    cluster_summaries: list[ClusterInfo] = Field(default_factory=list)
    plot_file_path: str
    metadata: dict = {}

class ImageAnalysisResponse(BaseModel):
    status: str = "success"
    processed_count: int
    result: ZipPipelineResult

# ──────────────────────────────────────────────
#  Audio Acoustic Feature Models
#  Task 1 – Audio Ingestion, Preprocessing & Feature Extraction
# ──────────────────────────────────────────────

class WaveformData(BaseModel):
    """Down-sampled waveform for the frontend player / waveform canvas."""
    timestamps: list[float]   # time points in seconds
    amplitudes: list[float]   # normalized amplitudes in [-1, 1]


class SpectrogramData(BaseModel):
    """
    STFT spectrogram down-sampled to 128 freq-bins × 100 time-bins.
    magnitude_db is a 2-D list: [freq_idx][time_idx] in decibels (clipped to [-80, 0]).
    """
    time_bins: list[float]           # seconds
    freq_bins: list[float]           # Hz
    magnitude_db: list[list[float]]  # [freq][time]


class EnergyData(BaseModel):
    """Frame-level RMS energy timeline, normalized to [0, 1]."""
    timestamps: list[float]
    rms_values: list[float]


class MFCCData(BaseModel):
    """13 MFCC coefficient tracks over time (optional, computed only on request)."""
    timestamps: list[float]
    coefficients: list[list[float]]  # [mfcc_idx][time_idx]


class AudioFeatures(BaseModel):
    """
    All acoustic features extracted from a single audio file.
    Attached to AudioAnalysisResult under the `features` key.
    """
    sample_rate: int
    duration: float
    num_channels: int
    waveform: WaveformData
    spectrogram: SpectrogramData
    energy: EnergyData
    mfcc: MFCCData | None = None


# ──────────────────────────────────────────────
#  Audio Analysis Models (Multimodal Pipeline)
#  Task 2 – API Integration & Data Management
# ──────────────────────────────────────────────

class SpeakerSegment(BaseModel):
    start: float
    end: float
    speaker: str
    text: str


class AudioAnalysisResult(BaseModel):
    duration: float
    segments: list[SpeakerSegment]
    transcript_text: str
    text_analysis: TextAnalysisResult | None = None
    features: AudioFeatures | None = None   # ← acoustic feature data (Task 1)


class AudioAnalysisResponse(BaseModel):
    status: str = "success"
    filename: str
    content_type: str
    result: AudioAnalysisResult


class AudioFeaturesResponse(BaseModel):
    """
    Response for the lightweight /audio-features endpoint.
    Returns only acoustic features – no Whisper/diarization required.
    Useful for demos and machines without HF token / large model downloads.
    """
    status: str = "success"
    filename: str
    content_type: str
    result: AudioFeatures
