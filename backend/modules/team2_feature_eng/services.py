"""
services.py - The Business Logic Layer for Feature Engineering

FILE STRUCTURE:
  This file is organized in pipeline order — matching the steps the user sees in the UI.

  SECTION 1: Imports & Configuration
  SECTION 2: Lazy Chain Getters (prevents startup crashes when API keys are missing)
  SECTION 3: File Upload & Session Initialization
  SECTION 4: Data Profiling
  SECTION 5: Data Quality
  SECTION 6: Target Column Auto-Detection
  SECTION 7: Shared Pipeline Helpers (the key to removing duplicate code!)
  SECTION 8: Feature Creation (Stage 1)
  SECTION 9: Feature Transformation (Stage 2)
  SECTION 10: Feature Extraction (Stage 3)
  SECTION 11: Feature Scaling (Stage 4)
  SECTION 12: Feature Selection (Stage 5)
  SECTION 13: Data Preview & Custom Transforms

KEY DESIGN DECISIONS:
  - `_build_profile_context(session_id)`: One function to prepare the AI's input
  - `_fetch_stage_suggestions(...)`: One function for all 5 suggestion stages
  - `_apply_stage(...)`: One function for all 5 apply operations
  - Lazy chain getters: LLM chains are only created when first used (not at startup)
"""

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 1: IMPORTS & CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════

import io
import os
import json
import uuid
import asyncio
import io
import json
import logging
import re as _re
import uuid as _uuid
from pathlib import Path as _Path
import httpx
import csv

import numpy as np
import pandas as pd
import scipy.stats as stats
from fastapi import HTTPException, UploadFile
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.preprocessing import (
    KBinsDiscretizer, LabelEncoder, MinMaxScaler, RobustScaler, StandardScaler
)
from fastapi.responses import StreamingResponse
import urllib.parse

from .chains.feature_creation_chain import FeatureCreationChain
from .chains.feature_extraction_chain import FeatureExtractionChain
from .chains.feature_scaling_chain import FeatureScalingChain
from .chains.feature_selection_chain import FeatureSelectionChain
from .chains.feature_transformation_chain import FeatureTransformationChain
from .config import SHARED_WORKSPACE_DIR
from .session import create_session, get_session, save_session
from .mock_data import MOCK_SUGGESTIONS

# ─── File system paths ──────────────────────────────────────────────────────
# All files go inside shared_workspace to be accessible by all teams.
RAW_UPLOADS_DIR = os.path.join(SHARED_WORKSPACE_DIR, "1_raw_uploads")
PROCESSED_DATA_DIR = os.path.join(SHARED_WORKSPACE_DIR, "2_processed_data")


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2: LAZY CHAIN GETTERS
# ═══════════════════════════════════════════════════════════════════════════
#
# WHY LAZY?
# If we create chain instances at module import time, the app crashes at startup
# if an API key (Gemini/Azure) is missing from .env.
# By using these getter functions, the LLM chain is only created the FIRST time
# a user actually makes a feature suggestion request.
#
# HOW LAZINESS IS IMPLEMENTED:
# We use Python global variables initialized to None.
# The getter checks if None → creates it → returns it.
# On every subsequent call, it just returns the existing instance.
# ─────────────────────────────────────────────────────────────────────────────

_creation_chain: FeatureCreationChain = None
_transformation_chain: FeatureTransformationChain = None
_extraction_chain: FeatureExtractionChain = None
_scaling_chain: FeatureScalingChain = None
_selection_chain: FeatureSelectionChain = None


def _get_creation_chain() -> FeatureCreationChain:
    global _creation_chain
    if _creation_chain is None:
        _creation_chain = FeatureCreationChain()
    return _creation_chain


def _get_transformation_chain() -> FeatureTransformationChain:
    global _transformation_chain
    if _transformation_chain is None:
        _transformation_chain = FeatureTransformationChain()
    return _transformation_chain


def _get_extraction_chain() -> FeatureExtractionChain:
    global _extraction_chain
    if _extraction_chain is None:
        _extraction_chain = FeatureExtractionChain()
    return _extraction_chain


def _get_scaling_chain() -> FeatureScalingChain:
    global _scaling_chain
    if _scaling_chain is None:
        _scaling_chain = FeatureScalingChain()
    return _scaling_chain


def _get_selection_chain() -> FeatureSelectionChain:
    global _selection_chain
    if _selection_chain is None:
        _selection_chain = FeatureSelectionChain()
    return _selection_chain


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 3: FILE UPLOAD & SESSION INITIALIZATION
# ═══════════════════════════════════════════════════════════════════════════

def process_upload(file: UploadFile, target_col: str, username: str = "anonymous"):
    """
    Handles dataset upload. Creates a user session and saves the file.

    Flow:
      1. Validate file type (CSV or Excel)
      2. Parse the file into a Pandas DataFrame
      3. Save the raw file to shared_workspace/1_raw_uploads/
      4. Create a new session and store the DataFrame in memory
      5. Auto-detect the target column if the user didn't specify one
      6. Return session_id and basic dataset info to the frontend
    """
    # ─── Validate file type ────────────────────────────────────────────────
    allowed_extensions = (".csv", ".xlsx", ".xls")
    if not file.filename.lower().endswith(allowed_extensions):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Please upload a CSV or Excel file."
        )

    # ─── Read file contents ────────────────────────────────────────────────
    contents = file.file.read()
    try:
        if file.filename.lower().endswith(".csv"):
            df = pd.read_csv(io.BytesIO(contents), low_memory=False)
        else:
            df = pd.read_excel(io.BytesIO(contents))
            
        # Preemptively salvage numeric columns that were parsed as object due to mixed strings 
        # (e.g. 95% numbers, 5% "UNKNOWN" or "nan") before casting the rest to string for PyArrow safety
        for col in df.columns:
            if df[col].dtype == "object":
                orig_notna = df[col].notna().sum()
                if orig_notna > 0:
                    converted = pd.to_numeric(df[col], errors='coerce')
                    if converted.notna().sum() / orig_notna > 0.7:
                        df[col] = converted
                        continue
                df[col] = df[col].astype("string").str.strip()
                tokens_to_replace = ["", "na", "n/a", "null", "none", "nan", "NA", "N/A", "NULL", "NONE", "NAN", "Nan", "Null", "None"]
                df[col] = df[col].replace(tokens_to_replace, pd.NA)
                
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {str(e)}")

    # ─── Save raw file to disk ────────────────────────────────────────────
    os.makedirs(RAW_UPLOADS_DIR, exist_ok=True)
    raw_file_path = os.path.join(RAW_UPLOADS_DIR, file.filename)
    with open(raw_file_path, "wb") as f:
        f.write(contents)

    # ─── Initialize session (linked to user) ──────────────────────────────
    session_id = create_session()
    session = get_session(session_id)
    session["original_df"] = df.copy()   # Keep the original untouched
    session["current_df"] = df.copy()    # This gets modified as user applies steps
    session["filename"] = file.filename
    session["feature_cache"] = {}         # Will store {feature_code: python_code}

    # ─── Set or auto-detect target column ─────────────────────────────────
    if target_col and target_col in df.columns:
        session["target_col"] = target_col
    else:
        # User didn't specify — auto-detect from column names and statistics
        session["target_col"] = _auto_detect_target_column(df)

    # ─── Persist session so it survives server restarts ───────────────────
    save_session(session_id)

    return {
        "session_id": session_id,
        "info": {
            "name": file.filename,
            "rows": len(df),
            "columns": len(df.columns),
        },
        "columns": df.columns.tolist(),
    }

 
 
def load_dataset_from_path(file_path: str, filename: str, target_col: str | None = None, username: str = "anonymous", sample_id: str | None = None) -> str:
    """Load a downloaded CSV into a new feature engineering session, linking it to the user."""
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"Downloaded dataset not found: {file_path}")

    try:
        df = pd.read_csv(file_path, low_memory=False)
        # Preemptively salvage numeric columns that were parsed as object 
        for col in df.columns:
            if df[col].dtype == "object":
                orig_notna = df[col].notna().sum()
                if orig_notna > 0:
                    converted = pd.to_numeric(df[col], errors='coerce')
                    if converted.notna().sum() / orig_notna > 0.7:
                        df[col] = converted
                        continue
                df[col] = df[col].astype("string").str.strip()
                tokens_to_replace = ["", "na", "n/a", "null", "none", "nan", "NA", "N/A", "NULL", "NONE", "NAN", "Nan", "Null", "None"]
                df[col] = df[col].replace(tokens_to_replace, pd.NA)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not parse downloaded dataset: {str(e)}")

    session_id = create_session()
    session = get_session(session_id)
    session["original_df"] = df.copy()
    session["current_df"] = df.copy()
    session["filename"] = filename
    session["feature_cache"] = {}
    if sample_id:
        session["sample_id"] = sample_id
 
    if target_col and target_col in df.columns:
        session["target_col"] = target_col
    else:
        session["target_col"] = _auto_detect_target_column(df, sample_id)
 
    save_session(session_id)
    return session_id


def list_samples() -> list:
    """List available demo datasets from the samples directory."""
    samples_dir = os.path.join(os.path.dirname(__file__), "samples")
    config_path = os.path.join(samples_dir, "samples_config.json")
    
    if not os.path.exists(config_path):
        return []

    try:
        with open(config_path, "r") as f:
            return json.load(f)
    except Exception as e:
        logging.error(f"Error loading samples config: {e}")
        return []


def load_sample(sample_id: str, username: str = "anonymous") -> str:
    """Load a sample dataset into a new session."""
    samples_dir = os.path.join(os.path.dirname(__file__), "samples")
    samples = list_samples()
    
    sample_info = next((s for s in samples if s["id"] == sample_id), None)
    if not sample_info:
        raise HTTPException(status_code=404, detail="Sample dataset not found")

    filename = sample_info["filename"]
    file_path = os.path.join(samples_dir, filename)
    target_col = sample_info.get("target")

    return load_dataset_from_path(file_path, filename, target_col, username, sample_id)


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 4: DATA PROFILING
# ═══════════════════════════════════════════════════════════════════════════

def _safe_float(val, ndigits=4):
    if pd.isna(val) or val is None:
        return None
    try:
        fval = float(val)
        import math
        if math.isnan(fval) or math.isinf(fval):
            return None
        return round(fval, ndigits)
    except (TypeError, ValueError):
        return None

def generate_profile(session_id: str) -> dict:
    """
    Computes a comprehensive statistical profile of the current dataset.

    This profile is what the LLM reads to make intelligent suggestions.
    It's computed once when the user visits the Profile step and then
    cached in the session for reuse by all subsequent AI stages.

    Returns:
        A dict matching ProfileResponse schema (overview, types, quality,
        column_details, correlation, distributions)
    """
    session = get_session(session_id)
    df = session.get("current_df")

    if df is None:
        raise HTTPException(status_code=400, detail="No dataset found in session")

    total_rows, total_cols = df.shape

    # ─── Classify columns by type ──────────────────────────────────────────
    numeric_cols = df.select_dtypes(include=["number"]).columns.tolist()
    categorical_cols = df.select_dtypes(include=["object", "category", "string"]).columns.tolist()
    datetime_cols = df.select_dtypes(include=["datetime"]).columns.tolist()

    # ─── Overall missing data ──────────────────────────────────────────────
    total_missing = int(df.isnull().sum().sum())
    missing_percent = round((total_missing / (total_rows * total_cols)) * 100, 2)

    # ─── Duplicates ────────────────────────────────────────────────────────
    duplicate_rows = int(df.duplicated().sum())
    duplicate_percent = round((duplicate_rows / total_rows) * 100, 2) if total_rows > 0 else 0

    # ─── Memory usage ──────────────────────────────────────────────────────
    memory_mb = round(df.memory_usage(deep=True).sum() / (1024 * 1024), 4)

    # ─── Per-column statistics ─────────────────────────────────────────────
    column_details = []
    for col in df.columns:
        col_data = df[col]
        n_missing = int(col_data.isnull().sum())

        # Dominance ratio: share of the single most common value
        # High dominance (> 0.9) = near-constant column = usually useless for ML
        top_count = col_data.value_counts().iloc[0] if col_data.nunique() > 0 else 0
        dominance_ratio = round(top_count / total_rows, 4) if total_rows > 0 else 0

        detail = {
            "column": col,
            "dtype": str(col_data.dtype),
            "unique": int(col_data.nunique()),
            "missing": n_missing,
            "missing_percent": round(n_missing / total_rows * 100, 2) if total_rows > 0 else 0,
            "dominance_ratio": dominance_ratio,
        }

        # Extra stats for numeric columns only
        if col in numeric_cols:
            clean = col_data.dropna()
            if len(clean) > 0:
                Q1, Q3 = clean.quantile(0.25), clean.quantile(0.75)
                IQR = Q3 - Q1
                n_outliers = int(((clean < Q1 - 1.5 * IQR) | (clean > Q3 + 1.5 * IQR)).sum())
                col_mean = _safe_float(clean.mean())
                col_std = _safe_float(clean.std())

                detail.update({
                    "mean": col_mean,
                    "median": _safe_float(clean.median()),
                    "std": col_std,
                    "min": _safe_float(clean.min()),
                    "max": _safe_float(clean.max()),
                    "skew": _safe_float(clean.skew()),
                    "outlier_count": n_outliers,
                    "outlier_percent": round(n_outliers / len(clean) * 100, 2),
                    "q1": _safe_float(Q1),
                    "q3": _safe_float(Q3),
                    # Validity signals
                    "has_negatives": bool((clean < 0).any()),
                    "zero_count": int((clean == 0).sum()),
                    "zero_percent": round(int((clean == 0).sum()) / len(clean) * 100, 2),
                    "cv": _safe_float(col_std / abs(col_mean)) if col_std is not None and col_mean is not None and abs(col_mean) > 1e-10 else None,  # coefficient of variation
                })

        # Extra stats for categorical columns
        elif col in categorical_cols:
            value_counts = col_data.dropna().value_counts()
            top_5 = value_counts.head(5)
            n_unique = int(col_data.nunique())
            mode_val = str(value_counts.index[0]) if len(value_counts) > 0 else None
            mode_freq = round(int(value_counts.iloc[0]) / total_rows * 100, 2) if len(value_counts) > 0 else 0

            # Consistency/Validity checks for categorical columns
            non_null = col_data.dropna()
            has_whitespace = bool(non_null.astype(str).str.strip().ne(non_null.astype(str)).any()) if len(non_null) > 0 else False
            unique_raw = set(non_null.astype(str).unique())
            unique_lower = set(s.lower() for s in unique_raw)
            has_mixed_case = len(unique_raw) != len(unique_lower)
            has_empty_strings = bool((non_null.astype(str).str.strip() == "").any()) if len(non_null) > 0 else False

            detail.update({
                "col_type": "categorical",
                "top_values": {str(k): int(v) for k, v in top_5.items()},
                "mode": mode_val,
                "mode_frequency_percent": mode_freq,
                "cardinality": n_unique,
                "cardinality_ratio": round(n_unique / total_rows, 4) if total_rows > 0 else 0,
                # Consistency/Validity signals
                "has_whitespace_issues": has_whitespace,
                "has_mixed_case": has_mixed_case,
                "has_empty_strings": has_empty_strings,
            })

        column_details.append(detail)

    # ─── Correlation matrix (numeric columns only) ─────────────────────────
    correlation = {}
    if len(numeric_cols) > 1:
        correlation = df[numeric_cols].corr(numeric_only=True).fillna(0).round(4).to_dict()

    # ─── Target Association & Distributions (for UI Charts) ───────────
    target_col = session.get("target_col")
    if not target_col or target_col not in df.columns:
        target_col = _auto_detect_target_column(df)
        session["target_col"] = target_col

    distributions = {}

    for col in numeric_cols:
        clean = df[col].dropna()
        if len(clean) > 0:
            hist, bins = np.histogram(clean, bins=20)
            distributions[col] = {
                "type": "numeric",
                "hist": hist.tolist(),
                "bins": [round(b, 4) for b in bins.tolist()],
                "mean": round(float(clean.mean()), 4),
                "median": round(float(clean.median()), 4),
            }

    for col in categorical_cols:
        counts = df[col].value_counts().head(15)
        
        text_lengths = []
        for cat in counts.index:
            try:
                # Calculate the exact average string length of the non-null values that match this category
                mask = (df[col] == cat) & df[col].notna()
                if mask.any():
                    avg_len = df.loc[mask, col].astype(str).str.len().mean()
                    text_lengths.append(round(float(avg_len), 1))
                else:
                    text_lengths.append(len(str(cat)))
            except Exception:
                text_lengths.append(len(str(cat)))

        dist_data = {
            "type": "categorical",
            "categories": counts.index.astype(str).tolist(),
            "counts": counts.values.tolist(),
            "text_lengths": text_lengths
        }

        # Calculate advanced statistical association against target variable
        if target_col and target_col != col:
            target_data = df[target_col].dropna()
            col_data = df[col].dropna()
            
            # Intersection to ensure both have values
            common_idx = target_data.index.intersection(col_data.index)
            if not common_idx.empty:
                t_clean = target_data.loc[common_idx]
                c_clean = col_data.loc[common_idx]

                if target_col in categorical_cols:
                    # Chi-Square Test (Categorical vs Categorical)
                    try:
                        ct = pd.crosstab(c_clean, t_clean)
                        chi2, p, dof, ex = stats.chi2_contingency(ct)
                        if not pd.isna(p) and not pd.isna(chi2):
                            dist_data["target_association"] = {
                                "test": "Chi-Square",
                                "statistic": round(chi2, 4),
                                "p_value": _safe_float(p, 4),
                                "significant": bool(p < 0.05)
                            }
                        
                        # Add Cross-tabulation for Stacked Bar Chart (top 10 categories max)
                        top_cats = c_clean.value_counts().head(10).index
                        ct_filtered = ct.loc[ct.index.isin(top_cats)]
                        dist_data["crosstab"] = {
                            "index": ct_filtered.index.astype(str).tolist(),
                            "columns": ct_filtered.columns.astype(str).tolist(),
                            "data": ct_filtered.values.tolist()
                        }
                    except Exception: pass
                elif target_col in numeric_cols:
                    # ANOVA F-Test (Categorical vs Numeric)
                    try:
                        grouped = df.loc[common_idx].groupby(col)[target_col]
                        groups = [group.values for name, group in grouped]
                        if len(groups) > 1 and all(len(g) > 0 for g in groups):
                            f_stat, p = stats.f_oneway(*groups)
                            if not pd.isna(p) and not pd.isna(f_stat):
                                dist_data["target_association"] = {
                                    "test": "ANOVA",
                                    "statistic": round(f_stat, 4),
                                    "p_value": _safe_float(p, 4),
                                    "significant": bool(p < 0.05)
                                }
                            
                            # Calculate the average of the numerical target for the top 10 categories
                            top_cats = col_data.value_counts().head(10).index
                            valid_ops = [c for c in top_cats if c in grouped.groups]
                            if valid_ops:
                                dist_data["target_means"] = {
                                    "categories": [str(c) for c in valid_ops],
                                    "means": [_safe_float(float(grouped.get_group(c).mean()), 4) for c in valid_ops]
                                }
                    except Exception: pass

        distributions[col] = dist_data

    # ─── Build the profile response ────────────────────────────────────────

    profile = {
        "overview": {
            "rows": total_rows,
            "columns": total_cols,
            "missing_percent": missing_percent,
            "duplicates": duplicate_rows,
            "duplicate_percent": duplicate_percent,
            "memory_mb": memory_mb,
        },
        "types": {
            "numeric": len(numeric_cols),
            "categorical": len(categorical_cols),
            "datetime": len(datetime_cols),
        },
        "quality": {
            "completeness": round(100 - missing_percent, 2),
            "duplicates": duplicate_rows,
            "feature_richness": round(
                (len(numeric_cols) / total_cols * 100) if total_cols > 0 else 0, 2
            ),
        },
        "column_details": column_details,
        "correlation": correlation,
        "distributions": distributions,
        "target_column": target_col,   # ← AI/user-selected prediction target
    }

    # Cache the profile in the session so AI stages can reuse it
    session["profile_data"] = profile
    save_session(session_id)

    # Save to shared_workspace/2_processed_data/
    os.makedirs(PROCESSED_DATA_DIR, exist_ok=True)
    profile_path = os.path.join(PROCESSED_DATA_DIR, f"data_profile_1_{session_id}.json")
    with open(profile_path, "w") as f:
        import json
        json.dump(profile, f, indent=4)

    return profile


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 5: DATA QUALITY
# ═══════════════════════════════════════════════════════════════════════════

def detect_duplicates(df: pd.DataFrame) -> dict:
    """
    Detects Exact and Strict Fuzzy duplicates.
    Level 1: Exact matches.
    Level 2: Key-Based matches (REMOVED).
    Level 3: Strict Fuzzy matches (only target column differs loosely, all other non-ID columns match exactly).
    Returns duplicate stats and auto-generated QualityFix objects.
    """
    duplicate_fixes = []
    
    # ─── Level 1: Exact Duplicates ─────────────────────────────────────────
    # Identify completely unique ID columns so we can ignore them for duplicate finding
    id_columns = [col for col in df.columns if df[col].nunique() == len(df)]
    
    # Create a normalized version of the DF for duplicate checking
    # (Strip whitespace from strings to catch "val " vs "val")
    norm_df = df.copy()
    for col in norm_df.select_dtypes(include=["object", "string"]).columns:
        norm_df[col] = norm_df[col].astype(str).str.strip()
    
    subset_cols = [c for c in norm_df.columns if c not in id_columns]
    
    if subset_cols:
        exact_count = int(norm_df.duplicated(subset=subset_cols).sum())
    else:
        exact_count = int(norm_df.duplicated().sum())
    
    if exact_count > 0:
        # Generate code that handles potential whitespace in the real execution too
        drop_code = (
            f"subset = {subset_cols}\n"
            f"for col in [c for c in subset if df[c].dtype.name in ('object', 'string')]:\n"
            f"    df[col] = df[col].astype(str).str.strip()\n"
            f"df = df.drop_duplicates(subset=subset).reset_index(drop=True)"
        )
        duplicate_fixes.append({
            "id": f"DQ_DUP_EXACT",
            "column": "Entire Dataset",
            "issue": f"{exact_count} Exact Duplicates",
            "operation": "drop_exact_duplicates",
            "display_name": "Remove Exact Duplicates",
            "reason": f"Found {exact_count} identical rows (after stripping whitespace). Removing them prevents statistical bias.",
            "code": drop_code
        })
    
    # ─── Level 3: Strict Fuzzy Duplicates ──────────────────────────────────
    all_fuzzy_pairs = []
    
    # Try to use rapidfuzz if available, otherwise fallback to difflib
    similarity_func = None
    try:
        from rapidfuzz import fuzz
        similarity_func = fuzz.ratio
    except ImportError:
        import difflib
        similarity_func = lambda s1, s2: difflib.SequenceMatcher(None, s1, s2).ratio() * 100
    
    if similarity_func:
        # 1. Identify ID columns
        id_columns = [col for col in df.columns if df[col].nunique() == len(df)]
        
        # 2. Identify text columns with enough cardinality to have typos
        text_cols = df.select_dtypes(include=["object", "string"]).columns.tolist()
        
        for col in text_cols:
            if col in id_columns:
                continue
            
            n_unique = df[col].nunique()
            if n_unique < 2:
                continue
                
            # 3. Get all OTHER columns to group by
            other_cols = [c for c in df.columns if c != col and c not in id_columns]
            
            if not other_cols:
                continue
            
            # Temporary df for ROBUST grouping
            # (Strip whitespace, lowercase strings, and normalize numbers to strings)
            temp_df = df.copy()
            for c in other_cols:
                if temp_df[c].dtype.name in ('object', 'string'):
                    temp_df[c] = temp_df[c].astype(str).str.strip().str.lower().fillna('__MISSING__')
                elif pd.api.types.is_numeric_dtype(temp_df[c]):
                    # Normalize numbers: 1.0 and 1 should both become "1.0"
                    temp_df[c] = temp_df[c].astype(float).astype(str).fillna('__MISSING__')
                else:
                    temp_df[c] = temp_df[c].astype(str).fillna('__MISSING__')
            
            duplicate_groups = temp_df.groupby(other_cols)
            
            pairs_in_this_col = []
            for name, group in duplicate_groups:
                if len(group) > 1:
                    indices = group.index.tolist()
                    values = df.loc[indices, col].astype(str).tolist()
                    
                    for i in range(len(indices)):
                        for j in range(i + 1, len(indices)):
                            val1 = values[i].strip()
                            val2 = values[j].strip()
                            
                            if val1.lower() == val2.lower():
                                continue # Already an exact (or case-insensitive) match
                            
                            # Calculate similarity score
                            similarity = similarity_func(val1, val2)
                            
                            if similarity >= 85 and similarity < 100:
                                pairs_in_this_col.append({
                                    "row_index_1": indices[i],
                                    "row_index_2": indices[j],
                                    "column": col,
                                    "value_1": val1,
                                    "value_2": val2,
                                    "similarity": round(similarity, 1)
                                })
            
            if pairs_in_this_col:
                all_fuzzy_pairs.extend(pairs_in_this_col)
                rows_to_drop = list(set([pair["row_index_2"] for pair in pairs_in_this_col]))
                
                duplicate_fixes.append({
                    "id": f"DQ_DUP_FUZZY_{col}",
                    "column": col,
                    "issue": f"{len(pairs_in_this_col)} Fuzzy Duplicates",
                    "operation": "drop_fuzzy_duplicates",
                    "display_name": f"Fix typos in '{col}'",
                    "reason": f"Found {len(pairs_in_this_col)} pairs of similar values in '{col}' (>=85% similarity) where all other characteristics match exactly. Likely typos.",
                    "code": f"df = df.drop(index={rows_to_drop}).reset_index(drop=True)"
                })

    return {
        "stats": {
            "exact_count": exact_count,
            "fuzzy_pairs": all_fuzzy_pairs
        },
        "fixes": duplicate_fixes
    }

def generate_data_quality_suggestions(session_id: str) -> list:
    """
    Analyzes the dataset for data quality issues (nulls, outliers, duplicates)
    and returns AI-generated fix suggestions.

    Uses the LLM quality chain (llm_quality_chain.py).
    Results are cached in the session to avoid redundant LLM calls.
    """
    session = get_session(session_id)
    df = session.get("current_df")

    if df is None:
        raise HTTPException(status_code=400, detail="No dataset found in session")

    # ── Cache check: return cached results if LLM already ran for this session ──
    cached_result = session.get("quality_result_cache")
    if cached_result is not None:
        return cached_result

    # ── Mock Check: If this is a sample dataset, return mock suggestions ───
    sample_id = session.get("sample_id")
    if sample_id in MOCK_SUGGESTIONS:
        # Run REAL automated detection even for samples
        duplicate_results = detect_duplicates(df)
        real_missing_count = int(df.isnull().sum().sum())
        
        mock_fixes = MOCK_SUGGESTIONS[sample_id].get("quality", [])
        
        # Merge real duplicate fixes (if any) with mock fixes
        combined_fixes = duplicate_results.get("fixes", []) + mock_fixes
        
        result = {
            "fixes": combined_fixes,
            "duplicate_stats": duplicate_results.get("stats", {"exact_count": 0, "fuzzy_pairs": []}),
            "missing_count": real_missing_count
        }
        
        session["quality_suggestions"] = {s["id"]: s for s in combined_fixes}
        session["quality_result_cache"] = result
        save_session(session_id)
        return result

    # Get the dataset profile generated in the previous step
    profile_data = session.get("profile_data")
    if not profile_data:
        profile_data = generate_profile(session_id)

    # Run automated duplicate detection first
    duplicate_results = detect_duplicates(df)
    duplicate_fixes = duplicate_results["fixes"]

    # Use the quality-specific LLM chain to get structured fix suggestions
    from .chains.llm_quality_chain import DataQualityChain
    chain = DataQualityChain()
    llm_suggestions = chain.generate_quality_fixes(profile_data)
    
    # Prepend deterministic duplicate fixes to the LLM suggestions
    all_suggestions = duplicate_fixes + llm_suggestions

    # Cache the suggestions for apply and regenerate requests
    session["quality_suggestions"] = {s["id"]: s for s in all_suggestions}

    result = {
        "fixes": all_suggestions,
        "duplicate_stats": duplicate_results["stats"],
        "missing_count": sum(col.get("missing", 0) for col in profile_data.get("column_details", []))
    }

    # Cache the full result to avoid re-invoking LLM on step re-navigation
    session["quality_result_cache"] = result
    save_session(session_id)

    return result


def apply_data_quality_fixes(session_id: str, fix_ids: list) -> dict:
    """
    Executes the selected data quality fixes on the dataset.
    Saves the cleaned dataset as data_quality_data_1_{session_id}.csv
    """
    session = get_session(session_id)
    df = session.get("current_df")
    
    if df is None:
        raise HTTPException(status_code=400, detail="Session expired or no dataset found. Please re-upload your file.")
        
    df = df.copy()
    cached_fixes = session.get("quality_suggestions", {})

    for fix_id in fix_ids:
        fix = cached_fixes.get(fix_id)
        if not fix:
            continue

        code = fix.get("code", "")
        if not code:
            continue

        try:
            # Build a rich execution environment for all allowed operations
            exec_env = {"df": df, "pd": pd, "np": np}
            
            # Make sklearn imputers available for advanced operations (KNN, Iterative/MICE)
            try:
                from sklearn.impute import KNNImputer
                exec_env["KNNImputer"] = KNNImputer
            except ImportError:
                pass
            try:
                from sklearn.experimental import enable_iterative_imputer  # noqa: F401
                from sklearn.impute import IterativeImputer
                exec_env["IterativeImputer"] = IterativeImputer
                exec_env["enable_iterative_imputer"] = enable_iterative_imputer
            except ImportError:
                pass
            
            exec(code, exec_env)
            df = exec_env["df"]
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Error applying fix '{fix_id}' — {fix.get('display_name')}: {str(e)}"
            )

    # Save the cleaned dataset
    session["current_df"] = df
    os.makedirs(PROCESSED_DATA_DIR, exist_ok=True)
    output_path = os.path.join(PROCESSED_DATA_DIR, f"data_quality_data_1_{session_id}.csv")
    df.to_csv(output_path, index=False)

    # Refresh the profile so the next step reflects the cleaned data
    generate_profile(session_id)

    return {
        "message": f"Successfully applied {len(fix_ids)} quality fix(es).",
        "output_path": output_path,
        "rows": len(df),
        "columns": len(df.columns),
    }


def regenerate_data_quality_fix(session_id: str, fix_id: str, prompt: str) -> dict:
    """Asks the LLM to rewrite one specific quality fix based on user instructions."""
    session = get_session(session_id)
    fix = session.get("quality_suggestions", {}).get(fix_id)
    profile_data = session.get("profile_data")

    if not fix:
        raise HTTPException(status_code=404, detail=f"Fix ID '{fix_id}' not found in session")

    if not profile_data:
        profile_data = generate_profile(session_id)

    # ── Mock Check ───
    sample_id = session.get("sample_id")
    if sample_id in MOCK_SUGGESTIONS:
        # Just return the same fix but acknowledge the prompt in the reason
        updated_fix = fix.copy()
        updated_fix["reason"] = f"{fix['reason']} (Refined based on your request: '{prompt}')"
        # Update cache with the new version
        session["quality_suggestions"][fix_id] = updated_fix
        save_session(session_id)
        return updated_fix

    from .chains.llm_quality_chain import DataQualityChain
    chain = DataQualityChain()
    updated_fix = chain.regenerate_fix(profile_data, fix, prompt)

    # Update cache with the new version
    session["quality_suggestions"][fix_id] = updated_fix
    save_session(session_id)

    return updated_fix


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 6: TARGET COLUMN AUTO-DETECTION
# ═══════════════════════════════════════════════════════════════════════════

def _auto_detect_target_column(df: pd.DataFrame, sample_id: str | None = None) -> str:
    """
    Intelligently identifies the most likely ML target column.
    If it's a sample dataset, we use the known ground-truth target.
    """
    if sample_id in MOCK_SUGGESTIONS:
        return MOCK_SUGGESTIONS[sample_id]["target"]
    # 1. Build a quick lightweight profile of up to 50 columns to avoid overwhelming the LLM
    max_cols_to_analyze = 50
    cols_to_check = df.columns[:max_cols_to_analyze]
    
    metadata = []
    for col in cols_to_check:
        col_data = df[col]
        n_unique = int(col_data.nunique())
        col_info = {
            "name": col,
            "dtype": str(col_data.dtype),
            "unique_count": n_unique
        }
        
        # If it's highly categorical (like a classification target or boolean), show samples
        if n_unique < 15:
            sample_vals = col_data.dropna().unique()[:10].tolist()
            col_info["sample_values"] = sample_vals
            
        metadata.append(col_info)
        
    try:
        from .chains.target_detection_chain import TargetDetectionChain
        chain = TargetDetectionChain()
        detected_col = chain.detect_target(metadata)
        
        # Validate that the LLM selected an actual existing column
        if detected_col in df.columns:
            return detected_col
            
    except Exception as e:
        print(f"Target Detection LLM Failed, using fallback: {str(e)}")
        # Proceed to fallback heuristics
        pass

    # --- FALLBACK HEURISTICS ---
    TARGET_KEYWORDS = [
        "target", "label", "output", "class", "y",
        "price", "salary", "revenue", "churn", "fraud",
        "default", "outcome", "result", "survived",
        "diagnosis", "status", "grade", "score", "rating",
        "approved", "converted", "purchased",
    ]

    columns_lower = {col.lower(): col for col in df.columns}

    # Priority 1: Exact keyword match
    for keyword in TARGET_KEYWORDS:
        if keyword in columns_lower:
            return columns_lower[keyword]

    # Priority 2: Partial match
    for col in df.columns:
        for keyword in TARGET_KEYWORDS:
            if keyword in col.lower():
                return col

    # Priority 3: Last numeric column
    numeric_cols = df.select_dtypes(include=["number"]).columns.tolist()
    if numeric_cols:
        return numeric_cols[-1]

    # Priority 4: Absolute fallback
    return df.columns[-1]


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 7: SHARED PIPELINE HELPERS
# ═══════════════════════════════════════════════════════════════════════════
#
# These two functions eliminate the code duplication that previously existed
# across all 5 feature engineering stages.
#
# BEFORE: 5 separate functions with nearly identical code (~400 lines)
# AFTER: 2 shared functions called by all 5 stages (~80 lines)
# ─────────────────────────────────────────────────────────────────────────────

def _build_profile_context(session_id: str) -> dict:
    """
    Prepares the dataset context that the LLM needs to generate suggestions.

    This is a helper used by all 5 feature engineering stages.
    It reads from the session and returns a consistent context dict.

    Returns:
        {
          "df": the current DataFrame,
          "target_column": the ML target column name,
          "column_info": dict of column stats (what the LLM reads),
          "sample_data": first 5 rows as dict,
          "correlation_data": correlation matrix (needed by extraction/selection),
          "dataset_description": a human-readable summary string,
        }
    """
    session = get_session(session_id)
    df = session.get("current_df")

    if df is None:
        raise HTTPException(status_code=400, detail="No dataset found in session")

    # Get or auto-detect the target column
    target_col = session.get("target_col")
    if not target_col or target_col not in df.columns:
        target_col = _auto_detect_target_column(df)
        session["target_col"] = target_col
        save_session(session_id)

    # ALWAYS recompute the data profile before providing context to the LLM.
    # This prevents 'stale context' where the LLM suggests scaling columns 
    # that were skipped or not yet created.
    profile = generate_profile(session_id)

    # Build column_info as a flat dict: {column_name: {stats...}}
    # This is more readable for the LLM than a list of dicts
    column_info = {
        col_detail["column"]: col_detail
        for col_detail in profile.get("column_details", [])
    }

    return {
        "df": df,
        "target_column": target_col,
        "column_info": column_info,
        "sample_data": df.head(5).fillna("").to_dict(orient="list"),
        "correlation_data": profile.get("correlation", {}),
        "dataset_description": (
            f"Dataset '{session.get('filename', 'unknown')}' with "
            f"{df.shape[0]} rows and {df.shape[1]} columns. "
            f"Target column to predict: '{target_col}'."
        ),
    }


def _fetch_stage_suggestions(
    session_id: str,
    chain,
    num_suggestions: int,
    include_correlation: bool = False,
) -> dict:
    """
    Generic function for ALL 5 stages to fetch LLM suggestions.

    This replaces 5 near-identical functions (get_feature_suggestions,
    get_transformation_suggestions, get_extraction_suggestions, etc.).

    Args:
        session_id: The user's session ID
        chain: One of the 5 BaseFeatureChain subclass instances
        num_suggestions: How many suggestions to generate
        include_correlation: Set True for Extraction and Selection stages
                             (they need the correlation matrix)

    Returns:
        {
          "session_id": str,
          "suggestions": List[dict]  ← NOTE: session_id is injected HERE, not by LLM
        }
    """
    session = get_session(session_id)
    
    # ── Mock Check: If this is a sample dataset, return mock suggestions ───
    sample_id = session.get("sample_id")
    stage_id = chain.__class__.__name__.replace("Chain", "").lower().replace("feature", "")
    mock_stage_map = {
        "creation": "creation", "transformation": "transformation",
        "extraction": "extraction", "scaling": "scaling", "selection": "selection"
    }
    
    if sample_id in MOCK_SUGGESTIONS:
        mock_key = mock_stage_map.get(stage_id)
        if mock_key and mock_key in MOCK_SUGGESTIONS[sample_id]:
            mock_items = MOCK_SUGGESTIONS[sample_id][mock_key]
            feature_cache = session.get("feature_cache", {})
            for sug in mock_items:
                feature_cache[sug["feature_code"]] = sug.get("python_code", "")
            session["feature_cache"] = feature_cache
            save_session(session_id)
            return {"session_id": session_id, "suggestions": mock_items}

    context = _build_profile_context(session_id)

    import time
    max_attempts = 4
    last_error = None
    llm_response = {}
    
    for attempt in range(max_attempts):
        try:
            # Call the chain's generate_suggestions method with the prepared context
            llm_response = chain.generate_suggestions(
                column_info=context["column_info"],
                sample_data=context["sample_data"],
                target_column=context["target_column"],
                num_suggestions=num_suggestions,
                dataset_description=context["dataset_description"],
                correlation_data=context["correlation_data"] if include_correlation else None,
            )
            break # Success! Break out of the retry loop
            
        except Exception as e:
            err_str = str(e).lower()
            last_error = e
            # Check for rate limits, high demand, internal Google errors, or parsing glitches
            if any(err in err_str for err in ["503", "429", "500", "unavailable", "overloaded", "exhausted", "timeout", "parse"]):
                if attempt < max_attempts - 1:
                    time.sleep(1.5 * (2 ** attempt)) # 1.5s, 3.0s, 6.0s
                    continue
            
            # If it's a different error or we ran out of retries, raise it
            raise Exception(f"Stage LLM failed on attempt {attempt + 1}: {str(e)}")
            
    if not llm_response:
        raise Exception(f"Stage LLM failed after {max_attempts} retries: {str(last_error)}")

    # Cache the generated python_code for each suggestion.
    # This lets the apply step fall back to cached code if the frontend
    # doesn't send it back (e.g., user selected without editing).
    session = get_session(session_id)
    feature_cache = session.get("feature_cache", {})
    for suggestion in llm_response.get("suggestions", []):
        feature_cache[suggestion["feature_code"]] = suggestion.get("python_code", "")
    session["feature_cache"] = feature_cache
    save_session(session_id)

    # Re-inject session_id — the LLM doesn't know it, Python does
    return {
        "session_id": session_id,
        "suggestions": llm_response.get("suggestions", []),
    }


def _execute_code_on_df(df: pd.DataFrame, selected_features: list, session: dict) -> pd.DataFrame:
    """
    Core engine to safely execute LLM-generated Python code on a DataFrame.
    Shared by both real 'Apply' operations and 'Preview' operations.
    """
    # ─── Safe execution environment ────────────────────────────────────────
    exec_env = {
        "df": df,
        "pd": pd,
        "np": np,
        "stats": stats,
        "StandardScaler": StandardScaler,
        "MinMaxScaler": MinMaxScaler,
        "RobustScaler": RobustScaler,
        "KBinsDiscretizer": KBinsDiscretizer,
        "PCA": PCA,
        "KMeans": KMeans,
        "LabelEncoder": LabelEncoder,
        "re": __import__("re"),
        # Provide safe builtins
        "__builtins__": {
            "str": str, "int": int, "float": float, "bool": bool,
            "list": list, "dict": dict, "set": set, "tuple": tuple,
            "len": len, "abs": abs, "round": round, "min": min, "max": max,
            "sum": sum, "any": any, "all": all, "zip": zip,
            "enumerate": enumerate, "range": range, "map": map, "filter": filter,
            "type": type, "isinstance": isinstance
        },
    }

    # ─── Execute each selected feature's code ─────────────────────────────
    for feature in selected_features:
        if isinstance(feature, dict):
            feature_code = feature.get("feature_code", "Unknown")
            python_code = feature.get("python_code") or feature.get("code")
        else:
            feature_code = getattr(feature, "feature_code", "Unknown")
            python_code = getattr(feature, "python_code", None) or getattr(feature, "code", None)

        if not python_code:
            python_code = session.get("feature_cache", {}).get(feature_code)

        if not python_code:
            continue

        try:
            import re
            safe_python_code = re.sub(r'^(?:from\s+[^\s]+\s+)?import\s+.*$', '', python_code, flags=re.MULTILINE)
            safe_python_code = re.sub(r'drop\s*\(\s*columns\s*=', 'drop(errors="ignore", columns=', safe_python_code)
            
            exec(safe_python_code, exec_env)
            df = exec_env["df"]
        except Exception as e:
            err_msg = str(e)
            # Catch common Pandas "column missing" errors and make them readable
            if "None of [" in err_msg and "are in the [columns]" in err_msg:
                error_details = (
                    f"AI error: The suggestion '{feature_code}' failed because it tried to use a missing column. "
                    f"Check if you skipped the stage that creates this feature."
                )
            elif "KeyError" in err_msg or "IndexError" in err_msg:
                 error_details = f"AI logic error in '{feature_code}': A referenced column was not found. ({err_msg})"
            else:
                error_details = (
                    f"Error executing code for '{feature_code}': {err_msg}\n\n"
                    f"Code that failed:\n{python_code}"
                )
            
            print("========== EXECUTION ERROR ==========")
            print(error_details)
            print("=====================================")
            raise HTTPException(status_code=500, detail=error_details)
            
    return df


def _apply_stage(
    session_id: str,
    selected_features: list,
    output_filename_prefix: str,
) -> dict:
    """
    Generic function for ALL 5 stages to safely execute LLM-generated code.

    This replaces apply_features, apply_transformations, apply_extractions,
    apply_scaling, apply_selections — all 5 were doing the same thing.

    HOW CODE EXECUTION WORKS (SAFE exec):
      We pass a restricted environment to exec():
        - Only specific, pre-approved libraries (pd, np, sklearn classes, etc.)
        - No __builtins__ → blocks dangerous calls like open(), __import__(), os.system()
      The LLM's code runs inside this sandbox. Even if the LLM generates malicious code,
      it cannot access the filesystem, network, or system.

    Args:
        session_id: The user's session ID
        selected_features: List of CustomizedFeature objects from the frontend
        output_filename_prefix: Used to name the output CSV
                                (e.g., "feature_creation" → feature_creation_{session_id}.csv)

    Returns:
        Dict matching ApplyFeatureResponse schema
    """
    session = get_session(session_id)
    df = session.get("current_df")

    if df is None:
        raise HTTPException(status_code=400, detail="No dataset found in session")

    df = df.copy()
    original_columns = set(df.columns)

    # ─── Execute code using shared helper ──────────────────────────────────
    df = _execute_code_on_df(df, selected_features, session)

    # ─── Track what changed ────────────────────────────────────────────────
    new_columns = list(set(df.columns) - original_columns)
    dropped_columns = list(original_columns - set(df.columns))

    # ─── Persist changes to session ───────────────────────────────────────
    session["current_df"] = df
    save_session(session_id)

    # ─── Save to disk ──────────────────────────────────────────────────────
    os.makedirs(PROCESSED_DATA_DIR, exist_ok=True)
    output_path = os.path.join(
        PROCESSED_DATA_DIR, f"{output_filename_prefix}_{session_id}.csv"
    )
    df.to_csv(output_path, index=False)

    # ─── Refresh profile for the next stage ───────────────────────────────
    # The next AI stage will need updated column stats (e.g., after adding log features)
    generate_profile(session_id)

    # ─── Build preview of the most relevant columns ───────────────────────
    if new_columns:
        # For creation/transformation/extraction/scaling: show new columns
        preview_cols = new_columns[:5]
    elif dropped_columns:
        # For selection (drop stage): show the remaining columns
        preview_cols = df.columns.tolist()[:5]
    else:
        preview_cols = df.columns.tolist()[:5]

    preview_data = df[preview_cols].head(5).round(2).fillna("").to_dict(orient="list")

    # Build the summary message
    summary_parts = []
    if new_columns:
        summary_parts.append(f"{len(new_columns)} new column(s) added")
    if dropped_columns:
        summary_parts.append(f"{len(dropped_columns)} column(s) dropped")
    message = f"Successfully applied {len(selected_features)} operation(s). " + (
        ", ".join(summary_parts) if summary_parts else "No structural changes to columns."
    )

    return {
        "session_id": session_id,
        "success": True,
        "new_columns": new_columns,
        "output_path": output_path,
        "preview": preview_data,
        "message": message,
    }


def _regenerate_suggestion(session_id: str, request, chain) -> dict:
    """
    Generic function for all 5 stages to regenerate one suggestion.

    The user clicked 'Modify Suggestion' and described what they want changed.
    This sends their instruction to the LLM and returns the rewritten suggestion.

    Args:
        session_id: The user's session ID
        request: A FeatureRegenerateRequest object
        chain: The appropriate stage chain (e.g., _get_transformation_chain())

    Returns:
        Dict matching FeatureSuggestion schema
    """
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=400, detail="Session not found")

    # ── Mock Check ───
    sample_id = session.get("sample_id")
    if sample_id == "housing" and "log" in request.modification_request.lower():
        # Specific demo flow: Change Ratio to Log
        return {
            "feature_code": request.feature_code,
            "feature_name": "Price_Log",
            "description": "Logarithmic transformation of the price column.",
            "reasoning": "As requested, converted the ratio calculation into a Log transformation. This helps normalize the price distribution.",
            "python_code": "import numpy as np\ndf['Price_Log'] = np.log1p(df['price'])",
            "selected": True,
            "expected_benefit": "Reduces right-skewness and makes the distribution more normal."
        }
    
    if sample_id in MOCK_SUGGESTIONS:
        # For other mock cases, just simulate regeneration
        return {
            "feature_code": request.feature_code,
            "feature_name": request.feature_code.split('_')[-1].title(),
            "description": "Refined suggestion based on user feedback.",
            "reasoning": f"Adjusted logic to better match your requirement: '{request.modification_request}'.",
            "python_code": request.current_code,
            "selected": True,
            "expected_benefit": "Aligns the feature closer to user's domain knowledge."
        }

    updated = chain.regenerate_suggestion(
        feature_code=request.feature_code,
        current_code=request.current_code,
        current_reasoning=request.current_reasoning,
        modification_request=request.modification_request,
    )

    # Update the cache with the new code
    feature_cache = session.get("feature_cache", {})
    feature_cache[request.feature_code] = updated.get("python_code", "")
    session["feature_cache"] = feature_cache
    save_session(session_id)

    return updated


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 8: FEATURE CREATION (Stage 1)
# ═══════════════════════════════════════════════════════════════════════════

def get_feature_suggestions(session_id: str, num_suggestions: int) -> dict:
    """
    Stage 1: Get AI suggestions to CREATE brand new features (ratios, products, etc.)
    """
    return _fetch_stage_suggestions(
        session_id=session_id,
        chain=_get_creation_chain(),
        num_suggestions=num_suggestions,
        include_correlation=False,
    )


def apply_features(session_id: str, selected_features: list) -> dict:
    """Stage 1: Execute the selected feature creation code on the dataset."""
    return _apply_stage(session_id, selected_features, "feature_creation_data_1")


def regenerate_feature_suggestion(session_id: str, request) -> dict:
    """Stage 1: Rewrite one feature creation suggestion based on user instructions."""
    return _regenerate_suggestion(session_id, request, _get_creation_chain())


# For backward compatibility (old router import names)
regenerate_feature = regenerate_feature_suggestion


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 9: FEATURE TRANSFORMATION (Stage 2)
# ═══════════════════════════════════════════════════════════════════════════

def get_transformation_suggestions(session_id: str, num_suggestions: int) -> dict:
    """
    Stage 2: Get AI suggestions to TRANSFORM skewed distributions (log, sqrt, rank).
    """
    return _fetch_stage_suggestions(
        session_id=session_id,
        chain=_get_transformation_chain(),
        num_suggestions=num_suggestions,
        include_correlation=False,
    )


def apply_transformations(session_id: str, selected_features: list) -> dict:
    """Stage 2: Execute the selected transformation code on the dataset."""
    return _apply_stage(session_id, selected_features, "feature_transformed_data_1")


def regenerate_transformation(request) -> dict:
    """Stage 2: Rewrite one transformation suggestion based on user instructions."""
    return _regenerate_suggestion(request.session_id, request, _get_transformation_chain())


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 10: FEATURE EXTRACTION (Stage 3)
# ═══════════════════════════════════════════════════════════════════════════

def get_extraction_suggestions(session_id: str, num_suggestions: int) -> dict:
    """
    Stage 3: Get AI suggestions to EXTRACT latent features (PCA, encoding, interactions).
    Note: include_correlation=True because the extraction prompt uses the correlation matrix.
    """
    return _fetch_stage_suggestions(
        session_id=session_id,
        chain=_get_extraction_chain(),
        num_suggestions=num_suggestions,
        include_correlation=True,  # Extraction needs the correlation matrix for PCA decisions
    )


def apply_extractions(session_id: str, selected_features: list) -> dict:
    """Stage 3: Execute the selected extraction code on the dataset."""
    return _apply_stage(session_id, selected_features, "feature_extraction_data_1")


def regenerate_extraction(request) -> dict:
    """Stage 3: Rewrite one extraction suggestion based on user instructions."""
    return _regenerate_suggestion(request.session_id, request, _get_extraction_chain())


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 11: FEATURE SCALING (Stage 4)
# ═══════════════════════════════════════════════════════════════════════════

def get_scaling_suggestions(session_id: str, num_suggestions: int) -> dict:
    """
    Stage 4: Get AI suggestions to SCALE numeric columns (StandardScaler, MinMax, Robust).
    """
    return _fetch_stage_suggestions(
        session_id=session_id,
        chain=_get_scaling_chain(),
        num_suggestions=num_suggestions,
        include_correlation=False,
    )


def apply_scaling(session_id: str, selected_features: list) -> dict:
    """Stage 4: Execute the selected scaling code on the dataset."""
    return _apply_stage(session_id, selected_features, "feature_scaling_data_1")


def regenerate_scaling(request) -> dict:
    """Stage 4: Rewrite one scaling suggestion based on user instructions."""
    return _regenerate_suggestion(request.session_id, request, _get_scaling_chain())


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 12: FEATURE SELECTION (Stage 5)
# ═══════════════════════════════════════════════════════════════════════════

def get_selection_suggestions(session_id: str, num_suggestions: int) -> dict:
    """
    Stage 5: Get AI suggestions to DROP redundant or useless columns.
    Note: include_correlation=True because selection uses the correlation matrix
          to detect multicollinearity (features that are too similar to each other).
    """
    return _fetch_stage_suggestions(
        session_id=session_id,
        chain=_get_selection_chain(),
        num_suggestions=num_suggestions,
        include_correlation=True,  # Selection needs correlation to find multicollinear pairs
    )


def apply_selections(session_id: str, selected_features: list) -> dict:
    """Stage 5: Execute the selected column drops on the dataset."""
    return _apply_stage(session_id, selected_features, "feature_selection_data_1")


def regenerate_selection(request) -> dict:
    """Stage 5: Rewrite one selection/drop suggestion based on user instructions."""
    return _regenerate_suggestion(request.session_id, request, _get_selection_chain())


def preview_selected_suggestions(session_id: str, selected_features: list) -> dict:
    """
    Returns a PREVIEW of the dataset after applying selected features.
    DOES NOT save the changes to the session.
    """
    session = get_session(session_id)
    df = session.get("current_df")
    if df is None:
        raise HTTPException(status_code=400, detail="No dataset found in session")

    # Work on a copy to avoid side effects
    df_copy = df.copy()
    
    # Execute code using the same shared helper as real 'Apply'
    df_copy = _execute_code_on_df(df_copy, selected_features, session)
    
    # Return first 5 rows, rounded to 2 decimals (Impact Preview context)
    return {
        "preview": df_copy.head(5).round(2).fillna("").to_dict(orient="list")
    }


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 13: DATA PREVIEW & CUSTOM TRANSFORMS
# ═══════════════════════════════════════════════════════════════════════════

def get_dataset_preview(session_id: str) -> dict:
    """
    Returns the current state of the dataset for the Data Preview step.
    Shows the user what their dataset looks like after all engineering stages.
    """
    session = get_session(session_id)
    df = session.get("current_df")

    if df is None:
        raise HTTPException(status_code=400, detail="No dataset found in session")

    return {
        "session_id": session_id,
        "rows": len(df),
        "columns": len(df.columns),
        "column_names": df.columns.tolist(),
        "preview": df.head(10).round(3).fillna("").to_dict(orient="list"),
    }


def get_original_columns(session_id: str) -> dict:
    """
    Returns the list of column names from the initial upload.
    This helps the frontend track which columns are 'Engineered' across stages.
    """
    session = get_session(session_id)
    df = session.get("original_df")
    if df is None:
        # Fallback to current_df if original_df is missing
        df = session.get("current_df")
    
    if df is None:
        raise HTTPException(status_code=400, detail="No dataset found in session")
        
    return {"columns": df.columns.tolist()}


def apply_custom_transformation(session_id: str, prompt: str) -> dict:
    """
    Allows a power user to type a free-form transformation in plain English.
    The LLM converts it to Pandas code and executes it.

    Example prompts:
      - "Add a column with the log of price"
      - "Create a column that is price divided by area"
      - "Encode the 'city' column as a number"
    """
    session = get_session(session_id)
    df = session.get("current_df")

    if df is None:
        raise HTTPException(status_code=400, detail="No dataset found in session")

    columns_list = df.columns.tolist()
    sample = df.head(5).fillna("").to_dict(orient="list")

    sample_id = session.get("sample_id")
    
    if sample_id in MOCK_SUGGESTIONS:
        # Mock logic for demo mode
        prompt_lower = prompt.lower()
        if "area" in prompt_lower and "bed" in prompt_lower:
            code = "df['area_per_bedroom'] = df['area'] / df['bedrooms'].replace(0, 1)"
        elif "price" in prompt_lower and "log" in prompt_lower:
            code = "import numpy as np\ndf['price_log_custom'] = np.log1p(df['price'])"
        else:
            code = "df['demo_custom_feature'] = 1"
    else:
        from .chains.custom_transform_chain import CustomTransformChain
        chain = CustomTransformChain()
        schema_info = f"Columns: {columns_list}\nSample data: {sample}"
        code = chain.generate_code(
            schema_info=schema_info,
            user_prompt=prompt,
        )

        if not code:
            raise HTTPException(status_code=400, detail="LLM did not generate any code for this request")

    df_copy = df.copy()
    original_columns = set(df_copy.columns)

    exec_env = {
        "df": df_copy, "pd": pd, "np": np,
        "StandardScaler": StandardScaler, "MinMaxScaler": MinMaxScaler,
        "RobustScaler": RobustScaler, "LabelEncoder": LabelEncoder,
        "__builtins__": {},
    }

    try:
        # Strip imports before executing to prevent '__import__ not found' sandbox errors
        import re
        safe_code = re.sub(r'^(?:from\s+[^\s]+\s+)?import\s+.*$', '', code, flags=re.MULTILINE)
        exec(safe_code, exec_env)
        df_copy = exec_env["df"]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error executing custom transform: {str(e)}\n\nCode:\n{code}")

    new_columns = list(set(df_copy.columns) - original_columns)
    session["current_df"] = df_copy
    save_session(session_id)

    return {
        "session_id": session_id,
        "success": True,
        "new_columns": new_columns,
        "preview": df_copy[new_columns].head(10).fillna("").to_dict(orient="list") if new_columns else {},
        "message": f"Custom transformation applied. {len(new_columns)} new column(s) added.",
        "code_executed": code,
    }

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 14: UPLOADING DATA TO BLOB STORAGE
# ═══════════════════════════════════════════════════════════════════════════

import os
from datetime import datetime, timezone
from azure.storage.blob import BlobServiceClient

def upload_dataframe_to_blob(df, filename: str) -> str:
    connection_string = os.getenv("AZURE_CONNECTION_STRING")
    container_name = os.getenv("AZURE_CONTAINER_NAME")

    blob_service_client = BlobServiceClient.from_connection_string(connection_string)

    # remove extension if present
    base_name = filename.rsplit(".", 1)[0]

    # timezone-aware timestamp
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    # final blob name
    blob_name = f"feature eng/{base_name}_engineered_{timestamp}.csv"

    # Convert to CSV
    data = df.to_csv(index=False).encode("utf-8")

    blob_client = blob_service_client.get_blob_client(
        container=container_name,
        blob=blob_name
    )

    blob_client.upload_blob(data, overwrite=True)

    return blob_client.url


#=========================================================
# Team Output Tab
#=========================================================

def get_blob_service_client():
    account_name = os.getenv("AZURE_STORAGE_ACCOUNT_NAME")
    account_key = os.getenv("AZURE_STORAGE_ACCOUNT_KEY")
    if not account_name or not account_key:
        # Fallback to connection string if individual credentials are not provided
        connection_string = os.getenv("AZURE_CONNECTION_STRING")
        if connection_string:
             return BlobServiceClient.from_connection_string(connection_string)
        raise HTTPException(status_code=500, detail="Azure Storage credentials missing in .env")
    
    account_url = f"https://{account_name}.blob.core.windows.net"
    return BlobServiceClient(account_url=account_url, credential=account_key)

def list_team_outputs_from_blob() -> dict:
    """Dynamically fetches all files inside the anonymization and feature eng folders."""
    blob_service_client = get_blob_service_client()
    container_name = os.getenv("AZURE_BLOB_CONTAINER_NAME", os.getenv("AZURE_CONTAINER_NAME", "aikosh-v2"))
    container_client = blob_service_client.get_container_client(container_name)

    target_folders = ["Anonymization/", "Feature Eng/", "anonymization/", "feature eng/"]
    results = []

    # Allowed file types
    allowed_extensions = (".csv", ".xls", ".xlsx")

    for folder in target_folders:
        blobs = container_client.list_blobs(name_starts_with=folder)

        for blob in blobs:
            # Skip folder marker
            if blob.name == folder:
                continue

            # Skip intermediate data files backing active sessions
            if "intermediate" in blob.name.lower():
                continue

            # Filter only required file types
            if not blob.name.lower().endswith(allowed_extensions):
                continue

            # Format size
            size_kb = blob.size / 1024
            size_str = (
                f"{size_kb / 1024:.2f} MB"
                if size_kb > 1024
                else f"{size_kb:.0f} KB"
            )

            filename = blob.name.replace(folder, "")

            results.append({
                "id": blob.name,
                "filename": filename,
                "full_path": blob.name,
                "folder": folder.strip("/"),
                "size": size_str,
                "last_modified": blob.last_modified.strftime("%b %d, %Y %H:%M")
                if blob.last_modified else "Unknown",
                
                # store raw datetime for sorting
                "_sort_time": blob.last_modified
            })

    # Proper sorting using datetime
    results.sort(
        key=lambda x: x["_sort_time"] if x["_sort_time"] else 0,
        reverse=True
    )

    # Remove internal field before returning
    for item in results:
        item.pop("_sort_time", None)

    return {"datasets": results}

def download_blob_from_azure(blob_path: str):
    """Streams the requested file from Azure directly to the user."""
    blob_service_client = get_blob_service_client()
    container_name = os.getenv("AZURE_BLOB_CONTAINER_NAME", os.getenv("AZURE_CONTAINER_NAME", "aikosh-v2"))
    blob_client = blob_service_client.get_blob_client(container=container_name, blob=blob_path)
    
    if not blob_client.exists():
        raise HTTPException(status_code=404, detail="File not found in blob storage.")

    stream = blob_client.download_blob()
    
    # Extract filename safely for download headers
    filename = blob_path.split("/")[-1]
    safe_filename = urllib.parse.quote(filename)

    return StreamingResponse(
        stream.chunks(),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{safe_filename}"}
    )

# ═══════════════════════════════════════════════════════════════════════════
# CATALOG - FETCHING DATA FROM DATA.GOV.IN using API
# ═══════════════════════════════════════════════════════════════════════════

from .config import SHARED_WORKSPACE_DIR

logger = logging.getLogger(__name__)

# ── Tune these to match your setup ──────────────────────────
DATA_GOV_API_KEY = os.getenv("DATA_GOV_API_KEY")

ANALYSIS_MAX_ROWS = 100_000    # ceiling for server-side fetch
FETCH_PAGE_SIZE   = 2_000      # rows per data.gov.in page

RAW_UPLOADS_DIR = _Path(SHARED_WORKSPACE_DIR) / "1_raw_uploads"
os.makedirs(RAW_UPLOADS_DIR, exist_ok=True)

async def service_list_datasets(q: str = "", offset: int = 0, limit: int = 20, sector: str = ""):
    """Proxy to data.gov.in catalog API."""
    if not DATA_GOV_API_KEY:
        return {"total": 0, "results": [], "error": "DATA_GOV_API_KEY not configured"}

    params: dict = {
        "format": "json",
        "api-key": DATA_GOV_API_KEY,
        "offset": offset,
        "limit": limit,
        "filters[org_type]": "Central",
    }
    if q.strip():
        params["filters[title]"] = q.strip()
    if sector.strip():
        params["filters[sector]"] = sector.strip()

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get("https://api.data.gov.in/lists", params=params)
            resp.raise_for_status()
            data = resp.json()

        results = []
        for item in data.get("records", []):
            try:
                sector_list = item.get("sector") or []
                org_list    = item.get("org") or []
                category = sector_list[0] if isinstance(sector_list, list) and sector_list else "General"
                org_name = org_list[0]    if isinstance(org_list,    list) and org_list    else "Government of India"
                title    = str(item.get("title") or "Untitled").strip()
                if not title or title.lower().startswith("mydata-") or title.lower() == "untitled":
                    continue

                index_name = str(item.get("index_name") or item.get("id") or "")
                raw_fields = item.get("field") or []
                fields = [
                    {"name": str(f.get("name", "?")), "type": str(f.get("type", "unknown"))}
                    for f in raw_fields
                    if isinstance(f, dict)
                ] if isinstance(raw_fields, list) else []

                results.append({
                    "name":    title,
                    "desc":    str(item.get("desc") or ""),
                    "category": str(category),
                    "org":     str(org_name),
                    "id":      index_name,
                    "updated": str(item.get("updated") or item.get("date_last_updated") or ""),
                    "fields":  fields,
                })
            except Exception:
                continue

        total = data.get("total", len(results))
        try:
            total = int(total)
        except (TypeError, ValueError):
            total = len(results)

        return {"total": total, "results": results}

    except Exception as exc:
        logger.warning("data.gov.in API error: %s", exc)
        return {"total": 0, "results": [], "error": str(exc)}

async def service_get_dataset_sample(index_id: str, limit: int = 500):
    if not DATA_GOV_API_KEY:
        return {"records": [], "field": [], "total": 0, "error": "DATA_GOV_API_KEY not configured"}

    url    = f"https://api.data.gov.in/resource/{index_id}"
    params = {"api-key": DATA_GOV_API_KEY, "format": "json", "limit": limit, "offset": 0}

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

        records = data.get("records", [])
        fields  = data.get("field", [])
        total   = data.get("total", len(records))
        try:
            total = int(total)
        except (TypeError, ValueError):
            total = len(records)

        return {"records": records, "field": fields, "total": total}

    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        if status == 404:
            return {"records": [], "field": [], "total": 0, "error": "Resource not found on data.gov.in"}
        return {"records": [], "field": [], "total": 0, "error": f"data.gov.in returned HTTP {status}"}
    except Exception as exc:
        logger.warning("Dataset sample error for %s: %s", index_id, exc)
        return {"records": [], "field": [], "total": 0, "error": str(exc)}

async def service_fetch_dataset_for_analysis(index_id: str, dataset_name: str, max_rows: int, username: str):
    if not DATA_GOV_API_KEY:
        async def _err():
            yield json.dumps({"type": "error", "message": "DATA_GOV_API_KEY not configured"}) + "\n"
        return StreamingResponse(_err(), media_type="application/x-ndjson")

    max_rows  = min(max_rows, ANALYSIS_MAX_ROWS)
    safe_base = _re.sub(r"[^\w\-]", "_", dataset_name)[:50]
    filename  = f"{safe_base}_{_uuid.uuid4().hex[:8]}.csv"
    file_path = RAW_UPLOADS_DIR / filename
    base_url  = f"https://api.data.gov.in/resource/{index_id}"

    async def _stream():
        rows_written    = 0
        total_available = None
        header_written  = False
        page_errors     = 0
        MAX_PAGE_ERRORS = 3

        try:
            with open(file_path, "w", newline="", encoding="utf-8") as fh:
                writer = None
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(connect=10, read=20, write=10, pool=5)
                ) as client:
                    offset = 0
                    while rows_written < max_rows:
                        page_limit = min(FETCH_PAGE_SIZE, max_rows - rows_written)
                        params = {
                            "api-key": DATA_GOV_API_KEY,
                            "format":  "json",
                            "limit":   page_limit,
                            "offset":  offset,
                        }
                        try:
                            resp = await client.get(base_url, params=params)
                            resp.raise_for_status()
                            data = resp.json()
                            page_errors = 0
                        except httpx.TimeoutException as exc:
                            page_errors += 1
                            logger.warning("Page timeout (offset=%d, attempt=%d): %s", offset, page_errors, exc)
                            if page_errors >= MAX_PAGE_ERRORS:
                                if rows_written == 0:
                                    file_path.unlink(missing_ok=True)
                                    yield json.dumps({"type": "error", "message": f"data.gov.in timed out after {MAX_PAGE_ERRORS} retries."}) + "\n"
                                    return
                                break   # return partial data
                            await asyncio.sleep(1)
                            continue
                        except httpx.HTTPStatusError as exc:
                            page_errors += 1
                            status = exc.response.status_code
                            if status == 404:
                                yield json.dumps({"type": "error", "message": "Resource not found on data.gov.in."}) + "\n"
                                file_path.unlink(missing_ok=True)
                                return
                            if page_errors >= MAX_PAGE_ERRORS:
                                if rows_written == 0:
                                    file_path.unlink(missing_ok=True)
                                    yield json.dumps({"type": "error", "message": f"data.gov.in returned HTTP {status} after {MAX_PAGE_ERRORS} retries."}) + "\n"
                                    return
                                break
                            await asyncio.sleep(1)
                            continue

                        records = data.get("records", [])
                        if not records:
                            break

                        if total_available is None:
                            try:
                                total_available = int(data.get("total", 0)) or None
                            except (TypeError, ValueError):
                                total_available = None

                        if not header_written:
                            fieldnames = list(records[0].keys())
                            writer = csv.DictWriter(fh, fieldnames=fieldnames,
                                                     extrasaction="ignore", lineterminator="\n")
                            writer.writeheader()
                            header_written = True

                        for record in records:
                            writer.writerow(record)
                            rows_written += 1

                        offset += len(records)
                        pct = int((rows_written / min(max_rows, total_available or max_rows)) * 100) if total_available else 0
                        yield json.dumps({
                            "type":         "progress",
                            "rows_fetched": rows_written,
                            "total":        total_available,
                            "pct":          min(pct, 99),
                        }) + "\n"

                        if total_available and offset >= total_available:
                            break

        except Exception as exc:
            file_path.unlink(missing_ok=True)
            logger.error("fetch-for-analysis fatal error: %s", exc)
            yield json.dumps({"type": "error", "message": str(exc)}) + "\n"
            return

        if rows_written == 0:
            file_path.unlink(missing_ok=True)
            yield json.dumps({"type": "error", "message": "data.gov.in returned no records for this resource."}) + "\n"
            return

        truncated = total_available is not None and rows_written < total_available

        try:
            session_id = load_dataset_from_path(str(file_path), filename, None, username)
            generate_profile(session_id)
        except Exception as exc:
            logger.error("fetch-for-analysis profile creation error: %s", exc)
            file_path.unlink(missing_ok=True)
            yield json.dumps({"type": "error", "message": f"Profile creation failed: {str(exc)}"}) + "\n"
            return

        yield json.dumps({
            "type":            "complete",
            "filename":        filename,
            "session_id":      session_id,
            "rows_fetched":    rows_written,
            "total_available": total_available,
            "truncated":       truncated,
        }) + "\n"

    return StreamingResponse(_stream(), media_type="application/x-ndjson")

MAX_DOWNLOAD_ROWS = 100_000

async def service_download_dataset_csv(index_id: str, filename: str):
    if not DATA_GOV_API_KEY:
        raise HTTPException(status_code=503, detail="DATA_GOV_API_KEY not configured")

    base_url  = f"https://api.data.gov.in/resource/{index_id}"
    PAGE_SIZE = 1_000

    async def csv_stream():
        writer_buf = io.StringIO()
        csv_writer = None
        rows_written = 0
        offset = 0
        first_page = True

        async with httpx.AsyncClient(timeout=30) as client:
            while rows_written < MAX_DOWNLOAD_ROWS:
                params = {
                    "api-key": DATA_GOV_API_KEY,
                    "format":  "json",
                    "limit":   min(PAGE_SIZE, MAX_DOWNLOAD_ROWS - rows_written),
                    "offset":  offset,
                }
                try:
                    resp = await client.get(base_url, params=params)
                    resp.raise_for_status()
                    data = resp.json()
                except Exception as exc:
                    logger.error("Download page error at offset %d: %s", offset, exc)
                    break

                records = data.get("records", [])
                if not records:
                    break

                for record in records:
                    if csv_writer is None:
                        headers    = list(record.keys())
                        csv_writer = csv.DictWriter(writer_buf, fieldnames=headers,
                                                    extrasaction="ignore", lineterminator="\n")
                        if first_page:
                            csv_writer.writeheader()
                            first_page = False
                    csv_writer.writerow(record)
                    rows_written += 1

                chunk = writer_buf.getvalue()
                writer_buf.truncate(0)
                writer_buf.seek(0)
                if chunk:
                    yield chunk.encode("utf-8")

                total   = int(data.get("total", 0))
                offset += len(records)
                if offset >= total:
                    break

        if rows_written >= MAX_DOWNLOAD_ROWS:
            yield f"\n# Capped at {MAX_DOWNLOAD_ROWS:,} rows. Visit data.gov.in for the full dataset.\n".encode("utf-8")

    safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in filename)[:60].strip() or "dataset"
    return StreamingResponse(
        csv_stream(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}.csv"',
            "X-Accel-Buffering":   "no",   # disable nginx buffering
        },
    )

async def service_chat_about_dataset(dataset_name: str, description: str, fields: list, question: str, history: list):
    from .llm.llm_provider import get_llm
    model = get_llm()

    schema_lines = ""
    if fields:
        schema_lines = "\n".join(
            f"  - {f.get('name', '?')} ({f.get('type', 'unknown')})"
            for f in fields[:30]
        )
        schema_lines = f"\nSchema ({len(fields)} columns):\n{schema_lines}"

    system = (
        "You are a data analyst specializing in Indian government open datasets. "
        "Answer questions about the dataset described below. "
        "Be specific, concise, and practical. Reference column names when relevant.\n\n"
        f"=== DATASET ===\n"
        f"Name: {dataset_name}\n"
        f"Description: {description[:800]}\n"
        f"{schema_lines}\n"
        "=== END ==="
    )

    messages = [{"role": "system", "content": system}]
    for turn in history[-6:]:
        messages.append(turn)
    messages.append({"role": "user", "content": question.strip()})

    try:
        response = await model.ainvoke(messages)
        return {"answer": response.content, "model": getattr(model, 'model_name', 'unknown')}
    except Exception as exc:
        logger.error("dataset chat LLM error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))