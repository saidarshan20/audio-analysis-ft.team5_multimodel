"""
Data Catalog endpoints (migrated from former Team5 router).

Mounted under:
  /team3_ocr{settings.api_prefix}/catalog/...
e.g.
  /team3_ocr/api/v1/catalog/datasets
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import re
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class CatalogSettings(BaseSettings):
    # data.gov.in API key
    data_gov_api_key: str = ""

    # Optional OpenAI-compatible LLM providers (used for /datasets/chat)
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    nvidia_api_key: str = ""
    nvidia_model: str = "meta/llama-3.3-70b-instruct"

    # Azure OpenAI
    azure_openai_endpoint: str = ""
    azure_openai_key: str = ""
    azure_openai_deployment: str = ""
    azure_openai_api_version: str = "2024-12-01-preview"

    # Limits
    analysis_max_rows: int = 100_000
    fetch_page_size: int = 2_000
    max_download_rows: int = 100_000

    # Workspace output
    catalog_upload_dir: str = "./shared_workspace/2_processed_data/catalog_downloads"

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": False,
        "extra": "ignore",
    }


settings = CatalogSettings()
_UPLOAD_DIR = Path(settings.catalog_upload_dir)
_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter(prefix="/catalog", tags=["Catalog - Data Catalog"])


def _get_llm_client():
    """Returns (client, model_name). Prefers Azure OpenAI, then NVIDIA, then Groq."""
    from openai import AsyncAzureOpenAI, AsyncOpenAI

    if (
        settings.azure_openai_endpoint
        and settings.azure_openai_key
        and settings.azure_openai_deployment
    ):
        return (
            AsyncAzureOpenAI(
                azure_endpoint=settings.azure_openai_endpoint,
                api_key=settings.azure_openai_key,
                api_version=settings.azure_openai_api_version or "2024-12-01-preview",
            ),
            settings.azure_openai_deployment,
        )

    if settings.nvidia_api_key:
        return (
            AsyncOpenAI(
                base_url="https://integrate.api.nvidia.com/v1",
                api_key=settings.nvidia_api_key,
            ),
            settings.nvidia_model,
        )

    if settings.groq_api_key:
        return (
            AsyncOpenAI(base_url="https://api.groq.com/openai/v1", api_key=settings.groq_api_key),
            settings.groq_model,
        )

    raise HTTPException(
        status_code=503,
        detail=(
            "No LLM configured (set AZURE_OPENAI_* or NVIDIA_API_KEY or GROQ_API_KEY in backend .env)"
        ),
    )


@router.get("/datasets")
async def list_datasets(q: str = "", offset: int = 0, limit: int = 20, sector: str = ""):
    """
    Proxy to data.gov.in catalog API.
    Returns { total, results: [{name, desc, category, org, id, updated, fields}] }
    """
    if not settings.data_gov_api_key:
        return {"total": 0, "results": [], "error": "DATA_GOV_API_KEY not configured"}

    params: dict = {
        "format": "json",
        "api-key": settings.data_gov_api_key,
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
                org_list = item.get("org") or []
                category = sector_list[0] if isinstance(sector_list, list) and sector_list else "General"
                org_name = org_list[0] if isinstance(org_list, list) and org_list else "Government of India"
                title = str(item.get("title") or "Untitled").strip()
                if not title or title.lower().startswith("mydata-") or title.lower() == "untitled":
                    continue

                index_name = str(item.get("index_name") or item.get("id") or "")
                raw_fields = item.get("field") or []
                fields = (
                    [
                        {"name": str(f.get("name", "?")), "type": str(f.get("type", "unknown"))}
                        for f in raw_fields
                        if isinstance(f, dict)
                    ]
                    if isinstance(raw_fields, list)
                    else []
                )

                results.append(
                    {
                        "name": title,
                        "desc": str(item.get("desc") or ""),
                        "category": str(category),
                        "org": str(org_name),
                        "id": index_name,
                        "updated": str(item.get("updated") or item.get("date_last_updated") or ""),
                        "fields": fields,
                    }
                )
            except Exception:
                continue

        total = data.get("total", len(results))
        try:
            total = int(total)
        except (TypeError, ValueError):
            total = len(results)

        return {"total": total, "results": results}

    except Exception as exc:
        error_message = str(exc).strip() or "Unable to reach data.gov.in right now. Please retry."
        logger.warning("data.gov.in API error: %s", error_message)
        return {"total": 0, "results": [], "error": error_message}


@router.get("/datasets/sample/{index_id:path}")
async def get_dataset_sample(index_id: str, limit: int = 500):
    """
    Fetch up to `limit` rows from a data.gov.in resource for in-browser preview.
    Returns { records: [...], field: [...], total: int }
    """
    if not settings.data_gov_api_key:
        return {"records": [], "field": [], "total": 0, "error": "DATA_GOV_API_KEY not configured"}

    url = f"https://api.data.gov.in/resource/{index_id}"
    params = {"api-key": settings.data_gov_api_key, "format": "json", "limit": limit, "offset": 0}

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, params=params)
            status = resp.status_code
            if status == 404:
                return {"records": [], "field": [], "total": 0, "error": "Resource not found on data.gov.in"}
            resp.raise_for_status()
            data = resp.json()

        records = data.get("records", [])
        fields = data.get("field", [])
        total = data.get("total", len(records))
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
        return {"records": [], "field": [], "total": 0, "error": str(exc) or "Unknown error"}


class FetchForAnalysisPayload(BaseModel):
    index_id: str
    dataset_name: str
    max_rows: int | None = None


@router.post("/datasets/fetch-for-analysis")
async def fetch_for_analysis(payload: FetchForAnalysisPayload):
    """
    Downloads the full dataset server-to-server from data.gov.in and writes
    a capped CSV to `catalog_upload_dir`. Streams NDJSON progress events.
    """
    if not settings.data_gov_api_key:
        raise HTTPException(status_code=400, detail="DATA_GOV_API_KEY not configured")

    max_rows = payload.max_rows or settings.analysis_max_rows
    max_rows = max(1, min(int(max_rows), int(settings.analysis_max_rows)))

    safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", payload.dataset_name).strip("_") or "dataset"
    filename = f"{safe_name[:60]}_{uuid.uuid4().hex[:8]}.csv"
    out_path = _UPLOAD_DIR / filename

    base_url = f"https://api.data.gov.in/resource/{payload.index_id}"
    page_size = max(100, min(int(settings.fetch_page_size), 5000))

    async def _stream():
        rows_fetched = 0
        total_available = None
        truncated = False
        fieldnames: list[str] | None = None

        try:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            with out_path.open("w", newline="", encoding="utf-8") as f:
                writer = None

                async with httpx.AsyncClient(timeout=30) as client:
                    offset = 0
                    max_page_errors = 3
                    page_errors = 0

                    while rows_fetched < max_rows:
                        params = {
                            "api-key": settings.data_gov_api_key,
                            "format": "json",
                            "limit": page_size,
                            "offset": offset,
                        }

                        try:
                            resp = await client.get(base_url, params=params)
                            status = resp.status_code
                            if status == 404:
                                yield json.dumps(
                                    {"type": "error", "message": "Resource not found on data.gov.in."}
                                ) + "\n"
                                return
                            if status >= 400:
                                page_errors += 1
                                if page_errors >= max_page_errors:
                                    yield json.dumps(
                                        {
                                            "type": "error",
                                            "message": f"data.gov.in returned HTTP {status} after {max_page_errors} retries.",
                                        }
                                    ) + "\n"
                                    return
                                await asyncio.sleep(0.5 * page_errors)
                                continue

                            data = resp.json()
                            if total_available is None:
                                total_available = data.get("total")
                                try:
                                    total_available = int(total_available)
                                except (TypeError, ValueError):
                                    total_available = None

                            records = data.get("records", []) or []
                            if not records:
                                break

                            # Establish header from either API schema or record keys
                            if fieldnames is None:
                                api_fields = data.get("field") or []
                                if isinstance(api_fields, list) and api_fields and isinstance(api_fields[0], dict):
                                    fieldnames = [str(x.get("name") or "").strip() for x in api_fields if x.get("name")]
                                    fieldnames = [x for x in fieldnames if x]
                                if not fieldnames:
                                    fieldnames = sorted({k for r in records for k in r.keys()})

                                writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
                                writer.writeheader()

                            if writer is None or fieldnames is None:
                                yield json.dumps({"type": "error", "message": "Failed to initialize CSV writer."}) + "\n"
                                return

                            for r in records:
                                if rows_fetched >= max_rows:
                                    truncated = True
                                    break
                                writer.writerow({k: r.get(k, "") for k in fieldnames})
                                rows_fetched += 1

                            offset += len(records)
                            pct = (
                                float(rows_fetched) / float(total_available) * 100
                                if total_available
                                else 0.0
                            )

                            yield json.dumps(
                                {
                                    "type": "progress",
                                    "rows_fetched": rows_fetched,
                                    "total": total_available,
                                    "pct": round(pct, 2),
                                }
                            ) + "\n"

                            if truncated:
                                break

                        except httpx.ReadTimeout:
                            page_errors += 1
                            if page_errors >= max_page_errors:
                                yield json.dumps(
                                    {
                                        "type": "error",
                                        "message": f"data.gov.in timed out after {max_page_errors} retries.",
                                    }
                                ) + "\n"
                                return
                            await asyncio.sleep(0.5 * page_errors)
                            continue

            if rows_fetched == 0:
                yield json.dumps(
                    {"type": "error", "message": "data.gov.in returned no records for this resource."}
                ) + "\n"
                return

            yield json.dumps(
                {
                    "type": "complete",
                    "filename": filename,
                    "rows_fetched": rows_fetched,
                    "total_available": total_available,
                    "truncated": truncated,
                }
            ) + "\n"

        except Exception as exc:
            logger.exception("fetch-for-analysis failed: %s", exc)
            yield json.dumps({"type": "error", "message": str(exc) or "Unknown error"}) + "\n"

    return StreamingResponse(_stream(), media_type="application/x-ndjson")


@router.get("/datasets/fetch-for-analysis/file/{filename}")
async def get_fetch_for_analysis_file(filename: str):
    """
    Return the previously fetched analysis CSV as plain text (for the UI to parse).
    """
    safe = Path(filename).name
    path = _UPLOAD_DIR / safe
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path, media_type="text/csv")


@router.get("/datasets/download/{index_id:path}")
async def download_dataset(index_id: str, filename: str = "dataset"):
    """
    Streams the full dataset from data.gov.in as a CSV file download.
    """
    if not settings.data_gov_api_key:
        raise HTTPException(status_code=400, detail="DATA_GOV_API_KEY not configured")

    safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", filename).strip("_") or "dataset"

    base_url = f"https://api.data.gov.in/resource/{index_id}"
    page_size = max(100, min(int(settings.fetch_page_size), 5000))
    max_rows = max(1, int(settings.max_download_rows))

    async def _iter_csv():
        async with httpx.AsyncClient(timeout=30) as client:
            offset = 0
            rows_streamed = 0
            fieldnames: list[str] | None = None

            while rows_streamed < max_rows:
                params = {
                    "api-key": settings.data_gov_api_key,
                    "format": "json",
                    "limit": page_size,
                    "offset": offset,
                }
                resp = await client.get(base_url, params=params)
                if resp.status_code == 404:
                    raise HTTPException(status_code=404, detail="Resource not found on data.gov.in")
                resp.raise_for_status()
                data = resp.json()
                records = data.get("records", []) or []
                if not records:
                    break

                if fieldnames is None:
                    api_fields = data.get("field") or []
                    if isinstance(api_fields, list) and api_fields and isinstance(api_fields[0], dict):
                        fieldnames = [str(x.get("name") or "").strip() for x in api_fields if x.get("name")]
                        fieldnames = [x for x in fieldnames if x]
                    if not fieldnames:
                        fieldnames = sorted({k for r in records for k in r.keys()})

                    header = ",".join(fieldnames) + "\n"
                    yield header.encode("utf-8")

                if not fieldnames:
                    break

                for r in records:
                    if rows_streamed >= max_rows:
                        break
                    line = ",".join(_csv_escape(str(r.get(k, "") or "")) for k in fieldnames) + "\n"
                    yield line.encode("utf-8")
                    rows_streamed += 1

                offset += len(records)

            if rows_streamed >= max_rows:
                footer = f"\n# Capped at {settings.max_download_rows:,} rows. Visit data.gov.in for the full dataset.\n"
                yield footer.encode("utf-8")

    headers = {"Content-Disposition": f'attachment; filename="{safe_name[:60]}.csv"'}
    return StreamingResponse(_iter_csv(), media_type="text/csv", headers=headers)


def _csv_escape(value: str) -> str:
    if any(ch in value for ch in [",", '"', "\n", "\r"]):
        return '"' + value.replace('"', '""') + '"'
    return value


class DatasetChatPayload(BaseModel):
    dataset_name: str
    description: str = ""
    fields: list[dict] = []
    question: str
    history: list[dict] = []


@router.post("/datasets/chat")
async def chat_about_dataset(payload: DatasetChatPayload):
    """Answer a question about a dataset using its metadata as LLM context."""
    client, model_name = _get_llm_client()

    field_lines = []
    for f in payload.fields or []:
        if not isinstance(f, dict):
            continue
        name = str(f.get("name") or "").strip()
        typ = str(f.get("type") or "").strip()
        if name:
            field_lines.append(f"- {name}{(' (' + typ + ')') if typ else ''}")

    system = (
        "You are a helpful data analyst. Answer questions about the given dataset using only the dataset metadata. "
        "If the metadata is insufficient, say what is missing and suggest next steps."
    )

    messages: list[dict] = [{"role": "system", "content": system}]
    for h in payload.history or []:
        if isinstance(h, dict) and h.get("role") in {"user", "assistant"} and isinstance(h.get("content"), str):
            messages.append({"role": h["role"], "content": h["content"]})

    messages.append(
        {
            "role": "user",
            "content": (
                f"Dataset name: {payload.dataset_name}\n\n"
                f"Description: {payload.description}\n\n"
                f"Fields:\n" + ("\n".join(field_lines) if field_lines else "(none)") + "\n\n"
                f"Question: {payload.question}"
            ),
        }
    )

    try:
        resp = await client.chat.completions.create(model=model_name, messages=messages, temperature=0.2)
        answer = (resp.choices[0].message.content or "").strip()
        return {"answer": answer or "No answer generated.", "model": model_name}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(exc) or 'Unknown error'}") from exc

