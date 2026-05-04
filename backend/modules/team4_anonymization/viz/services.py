import os
import io
import json
import logging
import math
import re
import pandas as pd
import numpy as np
from openai import AzureOpenAI
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger("uvicorn.error")

# ── Shared paths (data-viz) ───────────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, "..","..", ".."))
RAW_DATA_DIR = os.path.join(PROJECT_ROOT, "shared_workspace", "1_raw_uploads")
os.makedirs(RAW_DATA_DIR, exist_ok=True)


# ── Data-viz helpers ──────────────────────────────────────────────────────────

def _load_dataframe(filename: str, nrows: int = None) -> pd.DataFrame:
    """Load a CSV or Excel file from the raw uploads directory."""
    file_path = os.path.join(RAW_DATA_DIR, filename)
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Dataset not found: {filename!r}")
    if filename.lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(file_path, nrows=nrows)
    return pd.read_csv(file_path, nrows=nrows)


def get_dataset_info(filename: str) -> dict:
    """Return filename and column names from the first two rows of a dataset."""
    df = _load_dataframe(filename, nrows=2)
    return {"filename": filename, "columns": df.columns.tolist()}


def get_data_preview(filename: str) -> dict:
    """Return the first 100 rows plus per-column statistics."""
    df = _load_dataframe(filename)

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
            "min":          round(float(series.min()),  4) if is_numeric and pd.notnull(series.min()) else None,
            "max":          round(float(series.max()),  4) if is_numeric and pd.notnull(series.max()) else None,
            "mean":         round(float(series.mean()), 4) if is_numeric and pd.notnull(series.mean()) else None,
            "std_dev":      round(float(series.std()),  4) if is_numeric and pd.notnull(series.std()) else None,
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
    if chart_type != "histogram" and y_axis not in df.columns:
        raise ValueError(f"Column {y_axis!r} not found in dataset.")

    if chart_type in {"bar", "pie", "area", "line"}:
        data = (
            df[[x_axis, y_axis]]
            .dropna()
            .head(2000)
            .to_dict(orient="records")
        )

    elif chart_type == "scatter":
        data = (
            df[[x_axis, y_axis]]
            .dropna()
            .head(500)
            .to_dict(orient="records")
        )

    elif chart_type == "histogram":
        if pd.api.types.is_numeric_dtype(df[x_axis]):
            series = df[x_axis].dropna()
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
            agg = df[x_axis].value_counts().head(20).reset_index()
            agg.columns = [x_axis, "count"]
            data = agg.to_dict(orient="records")

    else:
        raise ValueError(
            f"Unsupported chart_type {chart_type!r}. "
            f"Choose from: bar, pie, area, line, scatter, histogram."
        )

    return {"chart_type": chart_type, "x_axis": x_axis, "y_axis": y_axis, "data": data}



class LLMDataVizService:
    def __init__(self):
        self.endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "")
        self.key = os.getenv("AZURE_OPENAI_API_KEY", "")
        self.deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-4o")
        self.api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-12-01-preview")
        self.client = None
        
        if not self.endpoint or not self.key:
            logger.warning("Azure OpenAI Service not configured correctly for DataViz. Check .env")
        else:
            try:
                self.client = AzureOpenAI(
                    api_key=self.key,
                    api_version=self.api_version,
                    azure_endpoint=self.endpoint
                )
            except Exception as e:
                logger.error(f"Failed to init OpenAI Client for DataViz: {e}")

    def get_recommendations(self, columns: list, column_stats: list) -> str:
        if not self.client:
            return "💡 Consider a Bar Chart for categorical columns and a Scatter Plot for numeric relationships. Use Histograms to check data distributions."
            
        system_prompt = (
            "You are an expert Data Visualization AI. "
            "Based on the column names and simple column statistics provided, suggest 2 or 3 insightful charts to visualize the data. "
            "IMPORTANT: You MUST ONLY recommend from the following strictly supported chart types: Bar Chart, Line Chart, Scatter Plot, Pie Chart, Area Chart, and Histogram. "
            "Do NOT suggest any unsupported chart types. "
            "Format your output nicely using markdown bolding. Explain briefly which column goes on the X-axis and Y-axis and what the insight is. "
            "CRITICAL: Do NOT include any conversational filler, greetings, pleasantries, or closing remarks like 'Let me know if you need further clarification!'. "
            "Just return the list of recommendations directly. Keep it brief and actionable."
        )
        
        user_prompt = f"Columns: {columns}\nStats: {json.dumps(column_stats, default=str)[:1500]}"
        
        try:
            response = self.client.chat.completions.create(
                model=self.deployment,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.7
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"DataViz LLM Error: {e}")
            return "💡 Suggestion: Try using Bar charts to view sums by category, or Scatter plots for comparing any two numeric variables."

ALLOWED_CHART_TYPES = {"bar", "line", "area", "scatter", "pie", "histogram"}
ALLOWED_AGGREGATIONS = {"sum", "avg", "count", "min", "max", "median"}

def _sanitize_float(val):
    """Convert NaN/Inf to None for JSON compatibility."""
    try:
        fval = float(val)
        if pd.isna(fval) or not math.isfinite(fval):
            return None
        return fval
    except (ValueError, TypeError):
        return None

def _extract_json_payload(raw: str) -> dict:
    """Best-effort JSON extraction from LLM output."""
    if not raw:
        return {}
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?", "", raw).strip()
        raw = re.sub(r"```$", "", raw).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", raw)
        if not match:
            return {}
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return {}

def _normalize_aggregation(aggregation: str, chart_type: str) -> str:
    agg = str(aggregation or "").strip().lower()
    if chart_type in {"scatter", "histogram"}:
        return "count"
    if agg in ALLOWED_AGGREGATIONS:
        return agg
    return "sum"

def _normalize_chart_type(chart_type: str) -> str:
    value = str(chart_type or "").strip().lower()
    return value if value in ALLOWED_CHART_TYPES else "bar"

def _default_axis_candidates(df: pd.DataFrame) -> tuple[list[str], list[str]]:
    numeric_cols = [col for col in df.columns if pd.api.types.is_numeric_dtype(df[col])]
    categorical_cols = [col for col in df.columns if not pd.api.types.is_numeric_dtype(df[col])]
    return categorical_cols, numeric_cols

def _fallback_visual_ideas(df: pd.DataFrame, max_ideas: int) -> list[dict]:
    categorical_cols, numeric_cols = _default_axis_candidates(df)
    ideas: list[dict] = []

    if categorical_cols and numeric_cols:
        ideas.append({
            "title": f"Compare {numeric_cols[0]} across {categorical_cols[0]}",
            "chart_type": "bar",
            "x_axis": categorical_cols[0],
            "y_axis": numeric_cols[0],
            "aggregation": "sum",
            "insight": "Good for quickly ranking categories and spotting top contributors.",
        })

    if len(numeric_cols) >= 2:
        ideas.append({
            "title": f"Relationship: {numeric_cols[0]} vs {numeric_cols[1]}",
            "chart_type": "scatter",
            "x_axis": numeric_cols[0],
            "y_axis": numeric_cols[1],
            "aggregation": "count",
            "insight": "Useful for checking correlation, clusters, and outliers.",
        })

    if numeric_cols:
        ideas.append({
            "title": f"Distribution of {numeric_cols[0]}",
            "chart_type": "histogram",
            "x_axis": numeric_cols[0],
            "y_axis": numeric_cols[0],
            "aggregation": "count",
            "insight": "Shows skew, spread, and concentration bands for one metric.",
        })

    if categorical_cols and numeric_cols:
        ideas.append({
            "title": f"Trend-style view of {numeric_cols[0]} by {categorical_cols[0]}",
            "chart_type": "line",
            "x_axis": categorical_cols[0],
            "y_axis": numeric_cols[0],
            "aggregation": "avg",
            "insight": "Helps identify directional shifts and local peaks.",
        })

    return ideas[:max_ideas]

def _coerce_idea(raw: dict, all_columns: list[str], numeric_columns: list[str], categorical_columns: list[str]) -> dict | None:
    chart_type = _normalize_chart_type(raw.get("chart_type", "bar"))

    if chart_type == "scatter":
        x_pool = numeric_columns or all_columns
    elif chart_type == "histogram":
        x_pool = numeric_columns or all_columns
    else:
        x_pool = categorical_columns or all_columns

    y_pool = numeric_columns or all_columns

    x_axis = str(raw.get("x_axis", "")).strip()
    y_axis = str(raw.get("y_axis", "")).strip()

    if x_axis not in all_columns:
        x_axis = x_pool[0] if x_pool else ""
    if y_axis not in all_columns:
        y_axis = y_pool[0] if y_pool else ""

    if not x_axis or not y_axis:
        return None

    if chart_type == "histogram":
        x_axis = y_axis

    aggregation = _normalize_aggregation(raw.get("aggregation", "sum"), chart_type)

    title = str(raw.get("title", "")).strip() or f"{chart_type.title()} idea"
    insight = str(raw.get("insight", "")).strip() or "AI-selected visualization idea."

    return {
        "title": title[:120],
        "chart_type": chart_type,
        "x_axis": x_axis,
        "y_axis": y_axis,
        "aggregation": aggregation,
        "insight": insight[:320],
    }

async def get_visual_ideas(filename: str, max_ideas: int = 4) -> dict:
    """
    Generate chart suggestions for a dataset using Azure OpenAI.
    Falls back to rule-based ideas if Azure is unavailable or returns invalid payload.
    """
    max_ideas = max(1, min(int(max_ideas or 4), 8))
    df = _load_dataframe(filename, nrows=3000)
    if df.empty:
        return {"provider": "heuristic", "ideas": []}

    all_columns = [str(col) for col in df.columns.tolist()]
    numeric_columns = [col for col in all_columns if pd.api.types.is_numeric_dtype(df[col])]
    categorical_columns = [col for col in all_columns if col not in numeric_columns]

    column_profile = []
    for col in all_columns:
        series = df[col]
        sample_values = [str(v) for v in series.dropna().astype(str).head(3).tolist()]
        profile = {
            "name": col,
            "dtype": "numeric" if col in numeric_columns else "categorical",
            "null_count": int(series.isna().sum()),
            "unique_count": int(series.nunique(dropna=True)),
            "sample_values": sample_values,
        }
        if col in numeric_columns and not series.dropna().empty:
            profile["min"] = _sanitize_float(series.min())
            profile["max"] = _sanitize_float(series.max())
            profile["mean"] = _sanitize_float(series.mean())
        column_profile.append(profile)

    api_key = os.getenv("AZURE_OPENAI_API_KEY") or os.getenv("AZURE_OPENAI_KEY")
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME")
    api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-01")

    if not api_key or not endpoint or not deployment:
        logger.warning("Azure OpenAI env vars missing for Team4 visual ideas; using heuristic fallback.")
        fallback = _fallback_visual_ideas(df, max_ideas)
        return {"provider": "heuristic", "ideas": fallback, "warning": "Azure OpenAI config missing; returned heuristic suggestions."}

    prompt = {
        "task": "Recommend high-value chart ideas for this tabular dataset.",
        "constraints": {
            "max_ideas": max_ideas,
            "allowed_chart_types": sorted(ALLOWED_CHART_TYPES),
            "allowed_aggregations": sorted(ALLOWED_AGGREGATIONS),
            "x_axis_must_be_existing_column": True,
            "y_axis_must_be_existing_column": True,
            "y_axis_should_be_numeric_when_possible": True,
            "response_json_schema": {
                "ideas": [
                    {
                        "title": "short title",
                        "chart_type": "bar|line|area|scatter|pie|histogram",
                        "x_axis": "existing column",
                        "y_axis": "existing column",
                        "aggregation": "sum|avg|count|min|max|median",
                        "insight": "one sentence explaining value",
                    }
                ]
            },
        },
        "dataset": {
            "filename": filename,
            "rows_sampled": int(len(df)),
            "columns": all_columns,
            "column_profile": column_profile,
        },
        "notes": [
            "Prefer categorical x-axis + numeric y-axis for bar/line/area/pie.",
            "For scatter use numeric x and numeric y.",
            "For histogram set x_axis and y_axis to the same numeric field.",
            "Return JSON only, no markdown."
        ],
    }

    try:
        from openai import AsyncAzureOpenAI

        client = AsyncAzureOpenAI(
            azure_endpoint=endpoint,
            api_key=api_key,
            api_version=api_version,
        )
        response = await client.chat.completions.create(
            model=deployment,
            response_format={"type": "json_object"},
            temperature=0.2,
            messages=[
                {"role": "system", "content": "You are a data visualization assistant. Respond with valid JSON only."},
                {"role": "user", "content": json.dumps(prompt)},
            ],
        )
        raw = response.choices[0].message.content or "{}"
        parsed = _extract_json_payload(raw)
        raw_ideas = parsed.get("ideas", []) if isinstance(parsed, dict) else []

        ideas: list[dict] = []
        if isinstance(raw_ideas, list):
            for candidate in raw_ideas:
                if not isinstance(candidate, dict):
                    continue
                normalized = _coerce_idea(candidate, all_columns, numeric_columns, categorical_columns)
                if normalized:
                    ideas.append(normalized)
                if len(ideas) >= max_ideas:
                    break

        if ideas:
            return {"provider": "azure-openai", "ideas": ideas[:max_ideas]}
    except Exception as exc:
        logger.exception("Azure visual idea generation failed: %s", exc)

    fallback = _fallback_visual_ideas(df, max_ideas)
    return {"provider": "heuristic", "ideas": fallback, "warning": "Azure request failed; returned heuristic suggestions."}
