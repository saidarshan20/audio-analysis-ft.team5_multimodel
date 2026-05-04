"""
schemas.py - All Data Contracts for the Feature Engineering API

WHAT IS A SCHEMA?
A schema is like a "contract" — it defines exactly what shape data must be
in when entering or leaving a function/endpoint. Think of it like a form
with required and optional fields.

WHY PYDANTIC?
FastAPI uses Pydantic to automatically:
  - Validate incoming JSON requests (reject bad data with clear errors)
  - Serialize outgoing Python objects to clean JSON responses
  - Document the API in the auto-generated Swagger UI

FILE ORGANIZATION:
  1. Upload & Session Schemas
  2. Profile Schemas
  3. Data Quality Schemas
  4. Feature Engineering Schemas (LLM Input/Output)
  5. API Response Schemas (what endpoints return to the frontend)
  6. Custom Transform & Preview Schemas
"""

from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any, Union, Literal


# =============================================================================
# 1. UPLOAD & SESSION SCHEMAS
# =============================================================================

class DatasetInfo(BaseModel):
    """Basic facts about the uploaded file shown in the UI header."""
    name: str = Field(description="Original filename e.g. 'housing.csv'")
    rows: int = Field(description="Number of rows in the dataset")
    columns: int = Field(description="Number of columns in the dataset")


class UploadResponse(BaseModel):
    """
    Returned when a user uploads a file.
    The frontend stores `session_id` and sends it with every subsequent request
    so the backend knows which dataset to work with.
    """
    session_id: str = Field(description="Unique ID for this user's working session")
    info: DatasetInfo
    columns: List[str] = Field(description="List of all column names in the dataset")

class SaveProgressRequest(BaseModel):
    """Payload for saving workflow step/stage progress."""
    step: str
    stage: int = 0

class TargetDetectionResponse(BaseModel):
    """
    Internal model used by the AI to return its confidence when guessing the target column.
    """
    target_column: str = Field(description="The exact name of the column detected as the target")
    reasoning: str = Field(description="Explanation of why this column was chosen based on statistics and heuristics")


# =============================================================================
# 2. DATA PROFILE SCHEMAS
# =============================================================================

class ProfileOverview(BaseModel):
    """High-level dataset summary shown in the Profile step."""
    rows: int
    columns: int
    missing_percent: float = Field(description="% of all cells that are missing")
    memory_mb: float = Field(description="Dataset size in megabytes")


class ProfileTypes(BaseModel):
    """Breakdown of how many columns are of each data type."""
    numeric: int
    categorical: int
    datetime: int


class ProfileQuality(BaseModel):
    """Simple quality score metrics (0-100%)."""
    completeness: float = Field(description="% of non-missing cells")
    feature_richness: float = Field(description="% of columns with more than 1 unique value")


class ColumnDetail(BaseModel):
    """
    Per-column statistics. Numeric columns have extra fields like mean, skew, outlier_percent.
    Categorical columns have top_values, mode, cardinality info.
    These stats are what the LLM reads to make intelligent suggestions.
    """
    column: str
    dtype: str = Field(description="Data type e.g. 'float64', 'object', 'int64'")
    unique: int = Field(description="Number of distinct values")
    missing: int = Field(description="Number of missing (NaN) cells")
    missing_percent: float = Field(default=0.0, description="% of rows that are missing")
    dominance_ratio: float = Field(default=0.0, description="% share of the single most common value")

    # Only present for numeric columns:
    mean: Optional[float] = None
    median: Optional[float] = None
    std: Optional[float] = None
    min: Optional[float] = None
    max: Optional[float] = None
    skew: Optional[float] = Field(None, description="Skewness. |skew| > 1 means high skew")
    outlier_percent: Optional[float] = Field(None, description="% of values outside IQR bounds")
    has_negatives: Optional[bool] = Field(None, description="Whether the column contains negative values")
    zero_count: Optional[int] = Field(None, description="Number of zero values in the column")
    zero_percent: Optional[float] = Field(None, description="% of values that are exactly zero")
    cv: Optional[float] = Field(None, description="Coefficient of variation (std/mean) — high CV = high spread")

    # Only present for categorical columns:
    col_type: Optional[str] = Field(None, description="'categorical' if this is a categorical column")
    top_values: Optional[Dict[str, int]] = Field(None, description="Top 5 most frequent values and their counts")
    mode: Optional[str] = Field(None, description="Most frequent value in the column")
    mode_frequency_percent: Optional[float] = Field(None, description="% of rows matching the mode value")
    cardinality: Optional[int] = Field(None, description="Number of unique categories")
    cardinality_ratio: Optional[float] = Field(None, description="unique/total_rows — high means near-unique (e.g. names)")
    has_whitespace_issues: Optional[bool] = Field(None, description="Whether values have leading/trailing whitespace")
    has_mixed_case: Optional[bool] = Field(None, description="Whether the same category appears in different cases (e.g. 'Yes' vs 'YES')")
    has_empty_strings: Optional[bool] = Field(None, description="Whether blank strings exist that aren't NaN")


class NumericDistribution(BaseModel):
    """Histogram data for a numeric column — used to draw charts on the frontend."""
    type: Literal["numeric"]
    hist: List[int]
    bins: List[float]
    mean: float
    median: float


class CategoricalDistribution(BaseModel):
    """Bar chart data for a categorical column."""
    type: Literal["categorical"]
    categories: List[str]
    counts: List[int]


# Allows profile.distributions to hold either numeric or categorical data
DistributionType = Union[NumericDistribution, CategoricalDistribution]


class ProfileResponse(BaseModel):
    """Full response returned by the /profile endpoint."""
    overview: ProfileOverview
    types: ProfileTypes
    quality: ProfileQuality
    column_details: List[ColumnDetail]
    correlation: Dict[str, Dict[str, float]] = Field(description="Pearson correlation matrix for numeric columns")
    distributions: Dict[str, DistributionType]


# =============================================================================
# 3. DATA QUALITY SCHEMAS
# =============================================================================

class QualityFix(BaseModel):
    """
    One AI-suggested data cleaning operation.
    The LLM outputs a list of these, and the user selects which ones to apply.
    """
    id: str = Field(description="Unique ID for this fix e.g. 'DQ_001'")
    column: str = Field(description="Name of the column to fix")
    issue: str = Field(description="Short description of the problem e.g. '23% Missing Values'")
    operation: str = Field(description="Internal operation key e.g. 'fill_median', 'drop_outliers'")
    display_name: str = Field(description="Human-readable label e.g. 'Median Imputation'")
    reason: str = Field(description="Why this fix is recommended given the column's statistics. YOU MUST STRICTLY FORMAT AS: 'Metric (Value) | Reasoning string'. Example: 'High Skew (1.32) | Log transformation reduces skewness...'")
    code: str = Field(description="Executable pandas code. The dataframe variable is `df`.")


class FuzzyDuplicatePair(BaseModel):
    """Represents a single detected fuzzy duplicate pair (typo)."""
    row_index_1: int
    row_index_2: int
    column: str
    value_1: str
    value_2: str
    similarity: float


class DuplicateStats(BaseModel):
    """Statistics about duplicate records detected before the LLM runs."""
    exact_count: int = Field(0, description="Total number of identical rows found.")
    fuzzy_pairs: List[FuzzyDuplicatePair] = Field(default_factory=list, description="List of typos found in otherwise identical rows.")


class DataQualityResponse(BaseModel):
    """The LLM's full batch of data cleaning suggestions, plus exact/fuzzy duplicate stats."""
    fixes: List[QualityFix]
    duplicate_stats: Optional[DuplicateStats] = None


class ApplyFixRequest(BaseModel):
    """Sent by the frontend when the user clicks 'Apply Selected Fixes'."""
    session_id: str
    fix_ids: List[str] = Field(description="List of fix IDs the user selected")


class RegenerateQualityRequest(BaseModel):
    """Sent when the user asks AI to modify a specific quality fix."""
    session_id: str
    fix_id: str
    prompt: str = Field(description="User's plain-English modification instruction")


# =============================================================================
# 4. FEATURE ENGINEERING — LLM SCHEMAS
#    (These define what the LLM outputs, not what the API returns)
# =============================================================================

class FeatureSuggestion(BaseModel):
    """
    ONE feature suggestion from the AI.
    This is the atomic unit of the feature engineering pipeline — every stage
    (Creation, Transformation, Extraction, Scaling, Selection) produces these.

    The `python_code` field is what actually gets executed on the dataset.
    """
    feature_code: str = Field(
        description="Unique short identifier for this feature. Use prefix: FC_ (creation), FT_ (transformation), FE_ (extraction), FS_ (scaling), FSL_ (selection)."
    )
    feature_name: str = Field(
        description="Descriptive column name or operation name e.g. 'price_log1p' or 'area_standardized'"
    )
    description: str = Field(
        description="One sentence explaining what this feature represents or what the operation does."
    )
    reasoning: str = Field(
        description="Why this specific feature helps predict the target column. YOU MUST STRICTLY FORMAT AS: 'Target: <target_col> | <Reasoning string>'. Example: 'Target: price | Area is strongly correlated with price...'"
    )
    python_code: str = Field(
        description=(
            "Executable Python code. RULES: "
            "(1) Use variable `df` for the dataframe. "
            "(2) Only use: pd, np, StandardScaler, MinMaxScaler, RobustScaler, PCA, KMeans, KBinsDiscretizer, LabelEncoder, stats. "
            "(3) Handle NaNs with .fillna() before computations. "
            "(4) For drops: use `df = df.drop(columns=[...])` NOT inplace=True. "
            "(5) DO NOT import anything — all libraries are pre-imported. "
            "(6) DO NOT reference columns that don't exist in the dataset."
        )
    )
    expected_benefit: str = Field(
        description="Expected improvement e.g. 'Reduces skewness from 2.1 to ~0.1, improving linear model performance'"
    )


class LLMSuggestionsResponse(BaseModel):
    """
    What the LLM returns when asked for a batch of suggestions.

    NOTE: This does NOT contain session_id — the LLM cannot know it.
    Python code in services.py re-injects session_id before sending to frontend.
    """
    suggestions: List[FeatureSuggestion]


# =============================================================================
# 5. FEATURE ENGINEERING — API REQUEST/RESPONSE SCHEMAS
#    (What the endpoints receive from and send to the frontend)
# =============================================================================

class FeatureCreationRequest(BaseModel):
    """Sent by the frontend to trigger AI suggestion generation for any stage."""
    session_id: str = Field(description="The session to generate suggestions for")
    num_suggestions: int = Field(default=5, ge=1, le=10, description="How many suggestions to generate")


class SuggestionsAPIResponse(BaseModel):
    """
    Returned to the frontend after fetching AI suggestions.
    Python injects session_id here — it does NOT come from the LLM.
    """
    session_id: str
    suggestions: List[FeatureSuggestion]


class CustomizedFeature(BaseModel):
    """
    One feature the user has selected to apply.
    Contains the feature code (ID) and the Python code to execute.
    The user may have edited the code in the UI, which is why we send it back.
    """
    feature_code: str = Field(description="Matches the feature_code from the suggestion")
    python_code: Optional[str] = Field(None, description="The AI-generated or user-edited code to execute")
    code: Optional[str] = Field(None, description="Alias for python_code (legacy support)")


class FeatureRegenerateRequest(BaseModel):
    """Sent when a user clicks 'Modify Suggestion' on any feature in any stage."""
    session_id: str
    feature_code: str = Field(description="Which suggestion to regenerate")
    current_reasoning: str = Field(description="The original AI reasoning for context")
    current_code: str = Field(description="The original AI code to rewrite")
    modification_request: str = Field(description="User's plain-English instruction e.g. 'use log instead of sqrt'")


class ApplyFeatureRequest(BaseModel):
    """Sent when the user clicks 'Apply & Next Stage'."""
    session_id: str
    selected_features: List[CustomizedFeature] = Field(
        description="The features the user has selected (checkboxed) to apply"
    )


class ApplyFeatureResponse(BaseModel):
    """Returned after executing the AI-generated Python code on the dataset."""
    session_id: str
    success: bool
    new_columns: List[str] = Field(description="Names of any new columns added to the dataset")
    output_path: str = Field(description="Where the processed CSV was saved on disk")
    preview: Dict[str, List[Any]] = Field(description="First 5 rows of the new/modified columns")
    message: str


# =============================================================================
# 6. CUSTOM TRANSFORM & PREVIEW SCHEMAS
# =============================================================================

class CustomTransformRequest(BaseModel):
    """
    Allows a power user to type a free-form transformation instruction
    that the AI will convert to Pandas code.
    """
    session_id: str
    prompt: str = Field(description="Natural language instruction e.g. 'Add a column with the ratio of income to age'")


class CustomTransformResponse(BaseModel):
    """Returned after a custom transformation is applied."""
    session_id: str
    success: bool
    new_columns: List[str]
    preview: Dict[str, List[Any]]
    message: str
    code_executed: str = Field(description="The exact code that was generated and executed")


class RegenerateFeatureRequest(BaseModel):
    """Legacy schema kept for backwards compatibility."""
    session_id: str
    feature_code: str
    prompt: str


class DatasetPreviewResponse(BaseModel):
    """Returned by the /preview endpoint for the Data Preview step."""
    session_id: str
    rows: int
    columns: int
    preview: Dict[str, List[Any]]
    column_names: List[str] = Field(default=[], description="All column names in the final processed dataset")


# =============================================================================
# 7. CATALOG SCHEMAS
# =============================================================================

class FetchForAnalysisRequest(BaseModel):
    index_id:     str
    dataset_name: str
    max_rows:     int = 100_000
    username:     Optional[str] = "anonymous"


class DatasetChatRequest(BaseModel):
    dataset_name: str
    description:  str
    fields:       List[Dict[str, Any]] = []
    question:     str
    history:      List[Dict[str, Any]] = []   
