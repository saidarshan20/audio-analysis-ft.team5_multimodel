import pandas as pd
from pathlib import Path

from .schemas import (
    DatasetMetadata, DatasetColumnsResponse, DatasetPreviewResponse,
    ColumnInfo, ValidateConfigRequest, ValidateConfigResponse,
)
from .enums import MLTask


def get_metadata(filepath: str, dataset_id: str, filename: str) -> DatasetMetadata:
    path = Path(filepath)
    df = pd.read_csv(filepath)
    return DatasetMetadata(
        id=dataset_id,
        filename=filename,
        total_rows=len(df),
        total_columns=len(df.columns),
        size_bytes=path.stat().st_size,
        category="Uploaded Dataset",
        description=f"{filename} - {len(df)} rows, {len(df.columns)} columns",
    )


def get_preview(filepath: str, dataset_id: str, rows: int = 10) -> DatasetPreviewResponse:
    df = pd.read_csv(filepath)
    preview = df.head(rows)
    return DatasetPreviewResponse(
        dataset_id=dataset_id,
        columns=list(df.columns),
        rows=preview.to_dict(orient="records"),
        total_rows=len(df),
    )


def get_columns(filepath: str, dataset_id: str) -> DatasetColumnsResponse:
    df = pd.read_csv(filepath)
    columns = []
    for col in df.columns:
        sample_vals = df[col].dropna().head(3).tolist()
        columns.append(ColumnInfo(
            name=col,
            dtype=str(df[col].dtype),
            null_count=int(df[col].isnull().sum()),
            unique_count=int(df[col].nunique()),
            sample_values=[str(v) for v in sample_vals],
        ))
    return DatasetColumnsResponse(dataset_id=dataset_id, columns=columns)


def validate_config(filepath: str, req: ValidateConfigRequest) -> ValidateConfigResponse:
    df = pd.read_csv(filepath)

    if req.target_column not in df.columns:
        return ValidateConfigResponse(valid=False, message=f"Target column '{req.target_column}' not found in dataset")

    missing_features = [f for f in req.feature_columns if f not in df.columns]
    if missing_features:
        return ValidateConfigResponse(valid=False, message=f"Feature columns not found: {missing_features}")

    if req.target_column in req.feature_columns:
        return ValidateConfigResponse(valid=False, message="Target column cannot be in features list")

    target_dtype = str(df[req.target_column].dtype)
    target_nunique = df[req.target_column].nunique()
    suggested = None

    if req.ml_task == MLTask.CLASSIFICATION:
        if target_nunique > 50 and target_dtype in ("float64", "int64"):
            suggested = MLTask.REGRESSION
            return ValidateConfigResponse(
                valid=True,
                message=f"Target has {target_nunique} unique values. Consider regression instead.",
                suggested_task=suggested,
            )
    elif req.ml_task == MLTask.REGRESSION:
        if target_dtype == "object":
            suggested = MLTask.CLASSIFICATION
            return ValidateConfigResponse(
                valid=True,
                message="Target is categorical. Consider classification instead.",
                suggested_task=suggested,
            )

    return ValidateConfigResponse(valid=True, message="Configuration is valid")
