import os
import pandas as pd
import logging
import math

logger = logging.getLogger(__name__)

# --- Paths ---
FILE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(FILE_DIR, "..", ".."))
RAW_DATA_DIR = os.path.join(PROJECT_ROOT, "shared_workspace", "1_raw_uploads")

os.makedirs(RAW_DATA_DIR, exist_ok=True)

# --- Helpers ---

def _sanitize_float(val):
    """Convert NaN/Inf to None for JSON compatibility."""
    try:
        fval = float(val)
        if pd.isna(fval) or not math.isfinite(fval):
            return None
        return fval
    except (ValueError, TypeError):
        return None

def _load_dataframe(filename: str, nrows: int = None) -> pd.DataFrame:
    """Load a CSV or Excel file from the raw uploads directory."""
    file_path = os.path.join(RAW_DATA_DIR, filename)
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Dataset not found: {filename!r}")
    
    ext = os.path.splitext(filename)[1].lower()
    if ext in (".xlsx", ".xls"):
        return pd.read_excel(file_path, nrows=nrows)
    return pd.read_csv(file_path, nrows=nrows)

# --- Public API ---

def get_dataset_info(filename: str) -> dict:
    """Return filename and column names from the first few rows of a dataset."""
    df = _load_dataframe(filename, nrows=5)
    return {"filename": filename, "columns": df.columns.tolist()}

def get_data_preview(filename: str) -> dict:
    """Return first 100 rows plus per-column statistics."""
    df = _load_dataframe(filename)

    # Convert to JSON-friendly format
    preview_rows = df.head(100).fillna("").astype(str).to_dict(orient="records")

    column_stats = []
    for col in df.columns:
        series = df[col]
        is_numeric = pd.api.types.is_numeric_dtype(series)

        stat_entry = {
            "name":         col,
            "type":         "numeric" if is_numeric else "categorical",
            "null_count":   int(series.isna().sum()),
            "unique_count": int(series.nunique()),
            "min":          _sanitize_float(round(float(series.min()),  4)) if is_numeric and not series.dropna().empty else None,
            "max":          _sanitize_float(round(float(series.max()),  4)) if is_numeric and not series.dropna().empty else None,
            "mean":         _sanitize_float(round(float(series.mean()), 4)) if is_numeric and not series.dropna().empty else None,
            "std_dev":      _sanitize_float(round(float(series.std()),  4)) if is_numeric and not series.dropna().empty else None,
            "top_category": None,
        }

        if not is_numeric:
            vc = series.value_counts()
            if not vc.empty:
                stat_entry["top_category"] = f"{vc.index[0]} ({int(vc.iloc[0])})"

        column_stats.append(stat_entry)

    return {
        "filename":     filename,
        "total_rows":   len(df),
        "total_cols":   len(df.columns),
        "columns":      df.columns.tolist(),
        "preview_rows": preview_rows,
        "column_stats": column_stats,
    }

def get_chart_data(filename: str, x_axis: str, y_axis: str, chart_type: str) -> dict:
    """
    Return chart-ready data from a dataset.
    
    For bar / pie / area / line  — returns raw rows (frontend aggregates).
    For scatter                  — returns up to 500 raw {x, y} pairs.
    For histogram                — returns pre-binned {x_axis, count} rows.
    """
    df = _load_dataframe(filename)
    chart_type = chart_type.lower()

    if x_axis not in df.columns:
        raise ValueError(f"Column {x_axis!r} not found in dataset.")
    
    # y_axis is optional for histograms (count of x_axis)
    if chart_type != "histogram" and y_axis not in df.columns:
        raise ValueError(f"Column {y_axis!r} not found in dataset.")

    if chart_type in {"bar", "pie", "area", "line"}:
        # Typical 2-variable plotting
        data = (
            df[[x_axis, y_axis]]
            .dropna()
            .head(2000)
            .to_dict(orient="records")
        )

    elif chart_type == "scatter":
        # Keep volume manageable
        data = (
            df[[x_axis, y_axis]]
            .dropna()
            .head(500)
            .to_dict(orient="records")
        )

    elif chart_type == "histogram":
        if pd.api.types.is_numeric_dtype(df[x_axis]):
            series = df[x_axis].dropna()
            if series.empty:
                data = []
            else:
                binned = pd.cut(series, bins=10)
                counts = binned.value_counts().sort_index()
                data = [
                    {
                        x_axis: f"{interval.left:.1f}-{interval.right:.1f}",
                        "count": int(cnt),
                    }
                    for interval, cnt in counts.items()
                ]
        else:
            # Frequency count for categorical histograms
            agg = df[x_axis].value_counts().head(20).reset_index()
            agg.columns = [x_axis, "count"]
            data = agg.to_dict(orient="records")

    else:
        raise ValueError(
            f"Unsupported chart_type {chart_type!r}. "
            f"Choose from: bar, pie, area, line, scatter, histogram."
        )

    return {"chart_type": chart_type, "x_axis": x_axis, "y_axis": y_axis, "data": data}
