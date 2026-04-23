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


class TopicSegment(BaseModel):
    segment: str
    topic: str


class SentenceSentiment(BaseModel):
    sentence: str
    sentiment: str  # "positive" | "negative" | "neutral"


class WordFrequency(BaseModel):
    word: str
    count: int


class TextAnalysisResult(BaseModel):
    summary: str = ""
    sentiment: Sentiment = Field(default_factory=lambda: Sentiment(positive=0, negative=0, neutral=1, overall_label="neutral"))
    entities: list[KGNode] = Field(default_factory=list)
    kg_nodes: list[KGNode] = Field(default_factory=list)
    kg_edges: list[KGEdge] = Field(default_factory=list)
    timeline: list[TimelineEvent] = Field(default_factory=list)
    locations: list[GeoLocation] = Field(default_factory=list)
    # Extended NLP fields (populated by full audio services.py prompt)
    emotion: str = ""
    tone: str = ""
    domain: str = ""
    environment: str = ""
    topic: str = ""
    theme: str = ""
    bullet_points: list[str] = Field(default_factory=list)
    action_items: list[str] = Field(default_factory=list)
    decisions: list[str] = Field(default_factory=list)
    agreements: list[str] = Field(default_factory=list)
    disagreements: list[str] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)
    unanswered_questions: list[str] = Field(default_factory=list)
    top_keywords: list[str] = Field(default_factory=list)
    top_keyphrases: list[str] = Field(default_factory=list)
    topic_segments: list[TopicSegment] = Field(default_factory=list)
    sentence_sentiments: list[SentenceSentiment] = Field(default_factory=list)
    word_frequencies: list[WordFrequency] = Field(default_factory=list)
    word_count: int = 0
    char_count: int = 0
    sentence_count: int = 0
    conversation_score: float | None = None


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

class GPSData(BaseModel):
    lat: float | None = None
    lng: float | None = None
    altitude: float | None = None

class TechnicalMetadata(BaseModel):
    make: str | None = None
    model: str | None = None
    lens: str | None = None
    focal_length: str | None = None
    focal_length_35mm: str | None = None
    aperture: str | None = None
    shutter_speed: str | None = None
    iso: str | None = None
    datetime: str | None = None
    gps: GPSData | None = None
    width: int | None = None
    height: int | None = None

class ClusterPoint(BaseModel):
    filename: str
    cluster_id: int
    umap_x: float
    umap_y: float
    objects: list[DetectedObject]
    description: str | None = None
    annotated_image_path: str | None = None
    metadata: TechnicalMetadata | None = None

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
    tempo: float = 0.0
    spectral_centroid_mean: float = 0.0
    mel_spectrogram: SpectrogramData | None = None
    mfcc: MFCCData | None = None
    # Pitch / gender estimation fields
    pitch_mean: float | None = None      # Mean F0 in Hz (None if not computed)
    pitch_std: float | None = None       # Std of F0 in Hz
    gender_tag: str = ""                  # "Likely Male" | "Likely Female" | "Indeterminate" | ""


# ──────────────────────────────────────────────
#  Audio Analysis Models (Multimodal Pipeline)
#  Task 2 – API Integration & Data Management
# ──────────────────────────────────────────────

class SpeakerSegment(BaseModel):
    start: float
    end: float
    speaker: str
    text: str


class SpeakerMetrics(BaseModel):
    """Per-speaker analytics derived from aligned segments."""
    wpm: float = 0.0
    dominance_ratio: float = 0.0
    participation_ratio: float = 0.0
    pitch_mean: float | None = None   # Mean F0 Hz for this speaker
    gender_tag: str = ""              # "Likely Male" | "Likely Female" | "Indeterminate"


class AudioQualityMetrics(BaseModel):
    snr: float | None = None
    loudness: float | None = None
    clarity: float | None = None
    cleanliness: float | None = None


class BackgroundNoiseClass(BaseModel):
    label: str
    confidence: float = 0.0
    time_share: float = 0.0
    category: str = ""
    penalty_weight: float = 0.0


class BackgroundNoiseEvent(BaseModel):
    label: str
    start: float
    end: float
    confidence: float = 0.0
    category: str = ""


class BackgroundNoiseSummary(BaseModel):
    top_background_classes: list[BackgroundNoiseClass] = Field(default_factory=list)
    detected_instruments: list[BackgroundNoiseClass] = Field(default_factory=list)
    noise_events_timeline: list[BackgroundNoiseEvent] = Field(default_factory=list)
    dominant_causes: list[str] = Field(default_factory=list)
    noise_severity_score: float = 0.0
    noise_penalty_points: float = 0.0


class AudioScoreComponents(BaseModel):
    base_overall_score: float | None = None
    noise_penalty_points: float = 0.0
    adjusted_overall_score: float | None = None
    dominant_causes: list[str] = Field(default_factory=list)


class AudioQuality(BaseModel):
    score_version: str = ""
    content_type: str = "speech"   # speech | non_speech | silent
    is_speech_present: bool = False
    duration_warning: bool = False
    confidence: float = 1.0
    overall_score: float | None = None
    composite_percent: float | None = None
    rating: str = "unscored"
    summary: str = ""
    snr_db: float | None = None
    clip_ratio: float = 0.0
    speech_frame_ratio: float = 0.0
    adjusted_overall_score: float | None = None
    noise_penalty_points: float = 0.0
    background_noise: BackgroundNoiseSummary | None = None
    score_components: AudioScoreComponents | None = None
    metrics: AudioQualityMetrics = Field(default_factory=AudioQualityMetrics)


class AudioVerdict(BaseModel):
    """LLM-generated plain-language verdict for the audio recording."""
    title: str = ""         # e.g. "Low Quality Audio | Nostalgic Tone"
    description: str = ""   # 1-2 sentence natural-language explanation


class AudioInterpretation(BaseModel):
    """Rule-based interpretation layer: converts raw metrics → human labels."""
    noise_label: str = ""       # "High Noise" | "Moderate Noise" | "Clean Audio"
    noise_root_cause: str = ""  # e.g. "fan, television"
    loudness_label: str = ""    # "Too Quiet" | "Normal" | "Too Loud"
    clarity_label: str = ""     # "Low" | "Moderate" | "High"
    speech_rate_label: str = "" # "Slow" | "Normal" | "Fast"
    silence_ratio: float = 0.0  # fraction of total duration that is silence
    speech_rate: float = 0.0    # overall WPM (word count / duration in minutes)


class AudioAnalysisResult(BaseModel):
    duration: float
    segments: list[SpeakerSegment]
    transcript_text: str
    text_analysis: TextAnalysisResult | None = None
    features: AudioFeatures | None = None   # ← acoustic feature data (Task 1)
    language: str = ""
    interruption_count: int = 0
    speaker_metrics: dict[str, SpeakerMetrics] = Field(default_factory=dict)
    audio_quality: AudioQuality | None = None
    # ── Decision layer (populated by interpretation + LLM verdict step) ──────
    verdict: AudioVerdict | None = None
    recommended_actions: list[str] = Field(default_factory=list)
    interpretation: AudioInterpretation | None = None
    word_cloud_base64: str | None = None


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
