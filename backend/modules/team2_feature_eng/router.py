"""
router.py - API Endpoints for the Feature Engineering Module

WHAT THIS FILE DOES:
  Defines all API endpoints (URLs) for the Feature Engineering pipeline.
  Each endpoint is a thin wrapper around a services.py function.

  The router itself does very little logic:
  - It receives the HTTP request from the frontend
  - It validates the request body (Pydantic does this automatically)
  - It calls the appropriate service function
  - It returns the response or raises an HTTP error

  All the actual business logic lives in services.py.

URL PREFIX: /team2_feature_eng
  e.g., POST /team2_feature_eng/upload
        GET  /team2_feature_eng/profile/{session_id}
        POST /team2_feature_eng/features/suggestions

ENDPOINT GROUPS:
  - /upload, /profile, /preview         → Core pipeline
  - /data-quality, /apply-fixes         → Data Quality (Step 2)
  - /features/*                          → Feature Creation (Stage 1)
  - /transformations/*                   → Feature Transformation (Stage 2)
  - /extractions/*                       → Feature Extraction (Stage 3)
  - /scaling/*                           → Feature Scaling (Stage 4)
  - /selection/*                         → Feature Selection (Stage 5)
  - /custom-transform/*                  → Power user free-form transform
"""
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, Depends, Header
from typing import Any, Dict, Optional
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import io as _io

from .schemas import (
    ApplyFeatureRequest,
    ApplyFeatureResponse,
    ApplyFixRequest,
    CustomTransformRequest,
    CustomTransformResponse,
    DatasetPreviewResponse,
    FeatureCreationRequest,
    FeatureRegenerateRequest,
    FeatureSuggestion,
    RegenerateQualityRequest,
    SuggestionsAPIResponse,
    UploadResponse,
    SaveProgressRequest,
    FetchForAnalysisRequest,
    DatasetChatRequest
)
from .audit.audit_models import AuditLogResponse, AuditLogsListResponse
from .audit.audit_db import get_audit_db, init_audit_db
from .audit.audit_service import create_audit_log, get_audit_logs
from .audit.audit_helper import get_user_id_from_token, log_audit
init_audit_db()
from .session_store.session_db import init_session_db
init_session_db()
from .services import (
    # Core pipeline
    process_upload,
    generate_profile,
    get_dataset_preview,
    load_dataset_from_path,
    list_samples,
    load_sample,
    # Data Quality
    generate_data_quality_suggestions,
    apply_data_quality_fixes,
    regenerate_data_quality_fix,
    # Feature Creation (Stage 1)
    get_feature_suggestions,
    apply_features,
    regenerate_feature,
    # Feature Transformation (Stage 2)
    get_transformation_suggestions,
    apply_transformations,
    regenerate_transformation,
    # Feature Extraction (Stage 3)
    get_extraction_suggestions,
    apply_extractions,
    regenerate_extraction,
    # Feature Scaling (Stage 4)
    get_scaling_suggestions,
    apply_scaling,
    regenerate_scaling,
    # Selection (Stage 5)
    get_selection_suggestions,
    apply_selections,
    regenerate_selection,
    # Preview
    preview_selected_suggestions,
    get_original_columns,
    # Custom Transform
    apply_custom_transformation,
    # Export
    upload_dataframe_to_blob,
    list_team_outputs_from_blob,
    download_blob_from_azure,
    # Catalog
    service_list_datasets,
    service_get_dataset_sample,
    service_fetch_dataset_for_analysis,
    service_download_dataset_csv,
    service_chat_about_dataset
)

router = APIRouter(prefix="/team2_feature_eng", tags=["Team 2 - Feature Engineering"])


# ═══════════════════════════════════════════════════════════════════════════
# AUDIT LOG ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/audit-logs", response_model=AuditLogsListResponse)
def get_audit_logs_endpoint(
    session_id: Optional[str] = None,
    action_category: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_audit_db)
):
    """
    Retrieve audit logs for the authenticated user.
    If no authentication token is provided, returns logs for anonymous user (user_id=0).
    """
    try:
        user_id = get_user_id_from_token(authorization)
        if user_id is None:
            user_id = 0  # Default to anonymous user
        
        logs, total = get_audit_logs(
            db=db,
            user_id=user_id,
            session_id=session_id,
            action_category=action_category,
            limit=limit,
            offset=offset
        )
        return AuditLogsListResponse(total=total, logs=logs)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════
# CORE PIPELINE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/samples")
def list_demo_samples():
    """List available demo datasets for the feature engineering pipeline."""
    try:
        return {"samples": list_samples()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/samples/load")
def load_demo_sample(
    sample_id: str,
    username: Optional[str] = Form("anonymous"),
    authorization: Optional[str] = Header(None),
    audit_db: Session = Depends(get_audit_db)
):
    """Load a demo dataset into a new session."""
    try:
        # Link user_id if token is available
        user_id = get_user_id_from_token(authorization)
        
        session_id = load_sample(sample_id, username)
        
        # Log the action
        log_audit(
            db=audit_db,
            user_id=user_id,
            session_id=session_id,
            action_type="load_sample",
            action_category="data_upload",
            details={"sample_id": sample_id}
        )
        
        # Get profile data immediately to mimic the upload flow
        profile_data = generate_profile(session_id)
        df_preview = get_dataset_preview(session_id)
        
        return {
            "session_id": session_id,
            "info": {
                "name": f"Sample: {sample_id.capitalize()}",
                "rows": df_preview.get("total_rows", 0),
                "columns": df_preview.get("total_columns", 0),
            },
            "profile": profile_data
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload", response_model=UploadResponse)
def upload_dataset(
    file: UploadFile = File(...),
    target_col: Optional[str] = Form(None),
    username: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None),
    audit_db: Session = Depends(get_audit_db)
):
    """
    Upload a CSV or Excel dataset to begin the feature engineering pipeline.
    """
    try:
        result = process_upload(file, target_col, username or "anonymous")
        
        # Log audit - safely extract session_id
        user_id = get_user_id_from_token(authorization)
        session_id = None
        info = {}
        if isinstance(result, dict):
            session_id = result.get("session_id")
            info = result.get("info", {})
        else:
            session_id = getattr(result, "session_id", None)
            info = getattr(result, "info", {})
        
        log_audit(
            db=audit_db,
            user_id=user_id,
            session_id=session_id,
            action_type="upload_dataset",
            action_category="data_upload",
            details={
                "filename": file.filename,
                "rows": info.get("rows", 0) if isinstance(info, dict) else 0,
                "columns": info.get("columns", 0) if isinstance(info, dict) else 0,
                "target_column": info.get("target_column", "N/A") if isinstance(info, dict) else "N/A"
            }
        )
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/profile/{session_id}")
def get_profile(session_id: str):
    """
    Compute and return the full statistical profile of the dataset.
    
    Returns column statistics (mean, std, skew, outlier%, etc.),
    correlation matrix, and distributions — all used by the AI stages.
    """
    try:
        return generate_profile(session_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/preview/{session_id}", response_model=DatasetPreviewResponse)
def get_preview(session_id: str):
    """
    Return the current state of the dataset for the Data Preview step.
    Shows rows, column names, and the first 10 rows of data.
    """
    try:
        return get_dataset_preview(session_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/dataset-info/{session_id}")
def get_dataset_info(session_id: str):
    """
    Return basic shape (rows, columns) of the current dataset.
    Used by the Export step to show final dimensions.
    """
    try:
        from .session import get_session
        session = get_session(session_id)
        df = session.get("current_df")
        if df is None:
            raise HTTPException(status_code=404, detail="No dataset found in session")
        return {"rows": len(df), "columns": len(df.columns)}
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/original-columns/{session_id}")
def fetch_original_columns(session_id: str):
    """
    Returns the list of column names before any feature engineering started.
    Used for highlighting engineered features in orange.
    """
    try:
        return get_original_columns(session_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════
# DATA QUALITY ENDPOINTS (Step 2)
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/data-quality/{session_id}")
def get_data_quality(session_id: str):
    """
    Analyze the dataset for quality issues and return AI-suggested fixes.
    Issues detected: missing values, outliers, duplicates, type mismatches.
    """
    try:
        results = generate_data_quality_suggestions(session_id)
        suggestions = results["fixes"]
        return {
            "session_id": session_id,
            "total_suggestions": len(suggestions),
            "suggestions": suggestions,
            "duplicate_stats": results["duplicate_stats"],
            "missing_count": results.get("missing_count", 0)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/apply-fixes")
def apply_fixes(
    request: ApplyFixRequest,
    authorization: Optional[str] = Header(None),
    audit_db: Session = Depends(get_audit_db)
):
    """
    Apply the user-selected data quality fixes to the dataset.
    Saves the cleaned dataset and refreshes the profile.
    """
    try:
        result = apply_data_quality_fixes(request.session_id, request.fix_ids)
        
        # Log audit
        user_id = get_user_id_from_token(authorization)
        log_audit(
            db=audit_db,
            user_id=user_id,
            session_id=request.session_id,
            action_type="apply_fixes",
            action_category="data_quality",
            details={"fix_ids": request.fix_ids, "fix_count": len(request.fix_ids)}
        )
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/data-quality/regenerate")
def regenerate_dq_fix(
    request: RegenerateQualityRequest,
    authorization: Optional[str] = Header(None),
    audit_db: Session = Depends(get_audit_db)
):
    """
    Ask the AI to rewrite one specific data quality fix based on user instructions.
    e.g., "Use mode imputation instead of median"
    """
    try:
        result = regenerate_data_quality_fix(request.session_id, request.fix_id, request.prompt)
        
        # Log audit
        user_id = get_user_id_from_token(authorization)
        log_audit(
            db=audit_db,
            user_id=user_id,
            session_id=request.session_id,
            action_type="regenerate_fix",
            action_category="data_quality",
            details={"fix_id": request.fix_id, "prompt": request.prompt}
        )
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════
# FEATURE CREATION ENDPOINTS (Stage 1)
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/features/suggestions", response_model=SuggestionsAPIResponse)
def get_feature_creation_suggestions(request: FeatureCreationRequest):
    """
    Stage 1: Ask the AI to suggest NEW features to create.
    Examples: price_per_sqft, total_rooms, log_income
    """
    try:
        return get_feature_suggestions(request.session_id, request.num_suggestions)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/features/apply", response_model=ApplyFeatureResponse)
def apply_feature_creation(
    request: ApplyFeatureRequest,
    authorization: Optional[str] = Header(None),
    audit_db: Session = Depends(get_audit_db)
):
    """
    Stage 1: Execute the AI-generated feature creation code on the dataset.
    Creates new columns from the selected suggestions.
    """
    try:
        result = apply_features(request.session_id, request.selected_features)
        
        # Log audit
        user_id = get_user_id_from_token(authorization)
        log_audit(
            db=audit_db,
            user_id=user_id,
            session_id=request.session_id,
            action_type="apply_features",
            action_category="feature_creation",
            details={"selected_features": request.selected_features, "feature_count": len(request.selected_features)}
        )
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/features/regenerate", response_model=FeatureSuggestion)
def regenerate_feature_creation(
    request: FeatureRegenerateRequest,
    authorization: Optional[str] = Header(None),
    audit_db: Session = Depends(get_audit_db)
):
    """
    Stage 1: Rewrite one feature creation suggestion based on user instructions.
    e.g., "Use multiplication instead of ratio"
    """
    try:
        result = regenerate_feature(request.session_id, request)
        
        # Log audit
        user_id = get_user_id_from_token(authorization)
        log_audit(
            db=audit_db,
            user_id=user_id,
            session_id=request.session_id,
            action_type="regenerate_feature",
            action_category="feature_creation",
            details={"feature_id": request.feature_code, "prompt": request.modification_request}
        )
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════
# FEATURE TRANSFORMATION ENDPOINTS (Stage 2)
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/transformations/suggestions", response_model=SuggestionsAPIResponse)
def get_transformation_suggestions_route(request: FeatureCreationRequest):
    """
    Stage 2: Ask the AI to suggest transformations to reduce skewness.
    Examples: log1p transform, square root, rank transform
    """
    try:
        return get_transformation_suggestions(request.session_id, request.num_suggestions)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/transformations/apply", response_model=ApplyFeatureResponse)
def apply_transformations_route(
    request: ApplyFeatureRequest,
    authorization: Optional[str] = Header(None),
    audit_db: Session = Depends(get_audit_db)
):
    """Stage 2: Execute the selected transformation code on the dataset."""
    try:
        result = apply_transformations(request.session_id, request.selected_features)
        
        # Log audit - get filename from session
        from .session import get_session
        session = get_session(request.session_id)
        filename = session.get("filename", "dataset")
        
        user_id = get_user_id_from_token(authorization)
        log_audit(
            db=audit_db,
            user_id=user_id,
            session_id=request.session_id,
            action_type="apply_transformations",
            action_category="transformation",
            details={
                "selected_features": request.selected_features, 
                "transformation_count": len(request.selected_features),
                "filename": filename
            }
        )
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/transformations/regenerate", response_model=FeatureSuggestion)
def regenerate_transformation_route(
    request: FeatureRegenerateRequest,
    authorization: Optional[str] = Header(None),
    audit_db: Session = Depends(get_audit_db)
):
    """Stage 2: Rewrite one transformation suggestion."""
    try:
        result = regenerate_transformation(request)
        
        # Log audit
        user_id = get_user_id_from_token(authorization)
        log_audit(
            db=audit_db,
            user_id=user_id,
            session_id=request.session_id,
            action_type="regenerate_transformation",
            action_category="transformation",
            details={"feature_id": request.feature_code, "prompt": request.modification_request}
        )
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════
# FEATURE EXTRACTION ENDPOINTS (Stage 3)
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/extractions/suggestions", response_model=SuggestionsAPIResponse)
def get_extraction_suggestions_route(request: FeatureCreationRequest):
    """
    Stage 3: Ask the AI to suggest extraction operations (PCA, encoding, interactions).
    Examples: PCA from correlated numeric columns, LabelEncoder for categoricals
    """
    try:
        return get_extraction_suggestions(request.session_id, request.num_suggestions)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/extractions/apply", response_model=ApplyFeatureResponse)
def apply_extractions_route(
    request: ApplyFeatureRequest,
    authorization: Optional[str] = Header(None),
    audit_db: Session = Depends(get_audit_db)
):
    """Stage 3: Execute the selected extraction code on the dataset."""
    try:
        result = apply_extractions(request.session_id, request.selected_features)
        
        # Log audit - get filename from session
        from .session import get_session
        session = get_session(request.session_id)
        filename = session.get("filename", "dataset")
        
        user_id = get_user_id_from_token(authorization)
        log_audit(
            db=audit_db,
            user_id=user_id,
            session_id=request.session_id,
            action_type="apply_extractions",
            action_category="extraction",
            details={
                "selected_features": request.selected_features, 
                "extraction_count": len(request.selected_features),
                "filename": filename
            }
        )
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/extractions/regenerate", response_model=FeatureSuggestion)
def regenerate_extraction_route(
    request: FeatureRegenerateRequest,
    authorization: Optional[str] = Header(None),
    audit_db: Session = Depends(get_audit_db)
):
    """Stage 3: Rewrite one extraction suggestion."""
    try:
        result = regenerate_extraction(request)
        
        # Log audit
        user_id = get_user_id_from_token(authorization)
        log_audit(
            db=audit_db,
            user_id=user_id,
            session_id=request.session_id,
            action_type="regenerate_extraction",
            action_category="extraction",
            details={"feature_id": request.feature_code, "prompt": request.modification_request}
        )
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════
# FEATURE SCALING ENDPOINTS (Stage 4)
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/scaling/suggestions", response_model=SuggestionsAPIResponse)
def get_scaling_suggestions_route(request: FeatureCreationRequest):
    """
    Stage 4: Ask the AI to suggest normalization strategies.
    Examples: StandardScaler, MinMaxScaler, RobustScaler
    """
    try:
        return get_scaling_suggestions(request.session_id, request.num_suggestions)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/scaling/apply", response_model=ApplyFeatureResponse)
def apply_scaling_route(
    request: ApplyFeatureRequest,
    authorization: Optional[str] = Header(None),
    audit_db: Session = Depends(get_audit_db)
):
    """Stage 4: Execute the selected scaling code on the dataset."""
    try:
        result = apply_scaling(request.session_id, request.selected_features)
        
        # Log audit
        from .session import get_session
        session = get_session(request.session_id)
        filename = session.get("filename", "dataset")
        
        user_id = get_user_id_from_token(authorization)
        log_audit(
            db=audit_db,
            user_id=user_id,
            session_id=request.session_id,
            action_type="apply_scaling",
            action_category="scaling",
            details={
                "selected_features": request.selected_features, 
                "scaling_count": len(request.selected_features),
                "filename": filename
            }
        )
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/scaling/regenerate", response_model=FeatureSuggestion)
def regenerate_scaling_route(
    request: FeatureRegenerateRequest,
    authorization: Optional[str] = Header(None),
    audit_db: Session = Depends(get_audit_db)
):
    """Stage 4: Rewrite one scaling suggestion."""
    try:
        result = regenerate_scaling(request)
        
        # Log audit
        user_id = get_user_id_from_token(authorization)
        log_audit(
            db=audit_db,
            user_id=user_id,
            session_id=request.session_id,
            action_type="regenerate_scaling",
            action_category="scaling",
            details={"feature_id": request.feature_code, "prompt": request.modification_request}
        )
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════
# FEATURE SELECTION ENDPOINTS (Stage 5)
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/selection/suggestions", response_model=SuggestionsAPIResponse)
def get_selection_suggestions_route(request: FeatureCreationRequest):
    """
    Stage 5: Ask the AI to identify columns to DROP.
    Targets: near-constant columns, multicollinear pairs, replaced raw columns
    """
    try:
        return get_selection_suggestions(request.session_id, request.num_suggestions)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/selection/apply", response_model=ApplyFeatureResponse)
def apply_selections_route(
    request: ApplyFeatureRequest,
    authorization: Optional[str] = Header(None),
    audit_db: Session = Depends(get_audit_db)
):
    """Stage 5: Execute the selected column drops on the dataset."""
    try:
        result = apply_selections(request.session_id, request.selected_features)
        
        # Log audit
        user_id = get_user_id_from_token(authorization)
        log_audit(
            db=audit_db,
            user_id=user_id,
            session_id=request.session_id,
            action_type="apply_selection",
            action_category="selection",
            details={
                "dropped_features": request.selected_features, 
                "drop_count": len(request.selected_features)
            }
        )
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/selection/regenerate", response_model=FeatureSuggestion)
def regenerate_selection_route(
    request: FeatureRegenerateRequest,
    authorization: Optional[str] = Header(None),
    audit_db: Session = Depends(get_audit_db)
):
    """Stage 5: Rewrite one drop suggestion."""
    try:
        result = regenerate_selection(request)
        
        # Log audit
        user_id = get_user_id_from_token(authorization)
        log_audit(
            db=audit_db,
            user_id=user_id,
            session_id=request.session_id,
            action_type="regenerate_selection",
            action_category="selection",
            details={"feature_id": request.feature_code, "prompt": request.modification_request}
        )
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════
# CUSTOM TRANSFORM ENDPOINT (Power User Feature)
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/custom-transform/apply", response_model=CustomTransformResponse)
def apply_custom_transform(
    request: CustomTransformRequest,
    authorization: Optional[str] = Header(None),
    audit_db: Session = Depends(get_audit_db)
):
    """
    Let a power user describe a transformation in plain English.
    The AI converts it to Pandas code and executes it.
    e.g., "Add a column with the ratio of bedrooms to total rooms"
    """
    try:
        result = apply_custom_transformation(request.session_id, request.prompt)
        
        # Log audit
        user_id = get_user_id_from_token(authorization)
        log_audit(
            db=audit_db,
            user_id=user_id,
            session_id=request.session_id,
            action_type="apply_custom_transform",
            action_category="custom_transform",
            details={
                "prompt": request.prompt,
                "code_executed": result.code_executed if hasattr(result, "code_executed") else None
            }
        )
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/preview-selected", response_model=Dict[str, Any])
def preview_features(request: ApplyFeatureRequest):
    """
    Returns a 5-row preview of the dataset assuming the selected features
    were applied. Does NOT persist any changes.
    Used for the 'Impact Preview' feature on the frontend.
    """
    try:
        return preview_selected_suggestions(request.session_id, request.selected_features)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════
# DOWNLOAD / EXPORT ENDPOINT
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/download/{session_id}")
def download_dataset(session_id: str, format: str = "csv"):
    """
    Download the final processed dataset in the chosen format.
    Supported formats: csv, json, parquet

    Called from the Export step on the frontend.
    """
    try:
        from .session import get_session
        session = get_session(session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found. Please upload a dataset first.")

    df = session.get("current_df")

    if df is None:
        raise HTTPException(status_code=404, detail="No dataset found in session. Complete at least the upload step.")

    filename = session.get("filename", "processed_dataset")
    base_name = filename.rsplit(".", 1)[0]  # Remove original extension

    if format == "csv":
        buf = _io.StringIO()
        df.to_csv(buf, index=False)
        buf.seek(0)
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={base_name}_engineered.csv"}
        )

    elif format == "json":
        buf = _io.StringIO()
        df.to_json(buf, orient="records", indent=2)
        buf.seek(0)
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename={base_name}_engineered.json"}
        )

    elif format == "parquet":
        buf = _io.BytesIO()
        df.to_parquet(buf, index=False, engine="pyarrow")
        buf.seek(0)
        return StreamingResponse(
            iter([buf.read()]),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename={base_name}_engineered.parquet"}
        )

    else:
        raise HTTPException(status_code=400, detail=f"Unsupported format '{format}'. Use: csv, json, parquet")
    
# ═══════════════════════════════════════════════════════════════════════════
# STORING IN BLOB - EXPORT ENDPOINT
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/export/{session_id}")
def export_dataset(session_id: str):
    """
    Export dataset to Azure Blob Storage (CSV only)
    """
    try:
        from .session import get_session
        session = get_session(session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found.")

    df = session.get("current_df")

    if df is None:
        raise HTTPException(
            status_code=404,
            detail="No dataset found in session."
        )

    # reuse filename from session
    filename = session.get("filename", "processed_dataset")

    try:
        file_url = upload_dataframe_to_blob(df, filename)

        return {
            "message": "Export successful",
            "file_url": file_url
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Export failed: {str(e)}"
        )


# ═══════════════════════════════════════════════════════════════════════════
# FETCHING FILES FROM BLOB ENDPOINTS (For Team Outputs Tab)
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/team-outputs")
def list_team_outputs():
    """Dynamically fetches all files inside the anonymization and feature eng folders."""
    try:
        return list_team_outputs_from_blob()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/download-team-outputs")
def download_blob(blob_path: str):
    """Streams the requested file from Azure directly to the user."""
    try:
        return download_blob_from_azure(blob_path)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ═══════════════════════════════════════════════════════════════════════════
# WORKFLOW SESSION PERSISTENCE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/sessions")
def get_all_sessions():
    """
    List all saved workflow sessions.
    Single-user mode — no auth filtering.
    """
    try:
        from .session import list_all_sessions
        sessions = list_all_sessions()
        return {"sessions": sessions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sessions/{session_id}/save-progress")
def save_session_progress(session_id: str, body: SaveProgressRequest):
    """
    Save the current step/stage progress for a session.
    Called automatically by the frontend on every step transition.
    """
    try:
        from .session import save_progress, save_session
        save_progress(session_id, body.step, body.stage)
        # Also persist the full session data
        save_session(session_id)
        return {"message": "Progress saved", "step": body.step, "stage": body.stage}
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sessions/{session_id}/resume")
def resume_saved_session(session_id: str):
    """
    Resume a previously saved session.
    Loads all cached data (DataFrames, profile, quality suggestions)
    back into memory and returns the frontend state.
    """
    try:
        from .session import resume_session
        return resume_session(session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/sessions/{session_id}")
def delete_saved_session(session_id: str):
    """
    Delete a saved session and all its persisted data.
    """
    try:
        from .session import delete_session
        delete_session(session_id)
        return {"message": "Session deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
# ═══════════════════════════════════════════════════════════════════════════
# CATALOG - FETCHING DATA FROM DATA.GOV.IN using API
# ═══════════════════════════════════════════════════════════════════════════

# ─────────────────────────────────────────────────────────────
# 1. GET /datasets — catalog listing
# ─────────────────────────────────────────────────────────────
@router.get("/datasets")
async def list_datasets(q: str = "", offset: int = 0, limit: int = 20, sector: str = ""):
    """
    Proxy to data.gov.in catalog API.
    Returns { total, results: [{name, desc, category, org, id, updated, fields}] }
    """
    return await service_list_datasets(q, offset, limit, sector)

# ─────────────────────────────────────────────────────────────
# 2. GET /datasets/sample/{index_id} — preview rows
# ─────────────────────────────────────────────────────────────
@router.get("/datasets/sample/{index_id:path}")
async def get_dataset_sample(index_id: str, limit: int = 500):
    """
    Fetch up to `limit` rows from a data.gov.in resource for in-browser preview.
    Returns { records: [...], field: [...], total: int }
    """
    return await service_get_dataset_sample(index_id, limit)

# ─────────────────────────────────────────────────────────────
# 3. POST /datasets/fetch-for-analysis — NDJSON stream download
# ─────────────────────────────────────────────────────────────
@router.post("/datasets/fetch-for-analysis")
async def fetch_dataset_for_analysis(payload: FetchForAnalysisRequest):
    """
    Downloads the full dataset server-to-server from data.gov.in and writes
    it to RAW_UPLOADS_DIR as a CSV. Streams NDJSON progress events so the
    browser can show a live progress bar.
    """
    return await service_fetch_dataset_for_analysis(
        payload.index_id, payload.dataset_name, payload.max_rows, payload.username
    )

# ─────────────────────────────────────────────────────────────
# 4. GET /datasets/download/{index_id} — stream CSV to browser
# ─────────────────────────────────────────────────────────────
@router.get("/datasets/download/{index_id:path}")
async def download_dataset_csv(index_id: str, filename: str = "dataset"):
    """
    Streams the full dataset from data.gov.in as a CSV file download.
    The API key stays server-side — never exposed to the browser.
    """
    return await service_download_dataset_csv(index_id, filename)

# ─────────────────────────────────────────────────────────────
# 5. POST /datasets/chat — AI chat about a dataset
# ─────────────────────────────────────────────────────────────
@router.post("/datasets/chat")
async def chat_about_dataset(payload: DatasetChatRequest):
    """Answer a question about a data.gov.in dataset using its metadata as LLM context."""
    return await service_chat_about_dataset(
        payload.dataset_name, payload.description, payload.fields,
        payload.question, payload.history
    )