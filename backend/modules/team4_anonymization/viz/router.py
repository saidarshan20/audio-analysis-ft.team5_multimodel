from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
import asyncio
import csv as _csv
import io
import json
import logging
import os
import re as _re
import shutil
import uuid as _uuid
from pathlib import Path as _Path
from pydantic import BaseModel
from .services import (
    LLMDataVizService, get_dataset_info, get_data_preview, get_chart_data, get_visual_ideas, RAW_DATA_DIR,
)
import httpx
import pandas as pd
#changed router prefx from /team4 to /team4/viz, just to seperate from anonymization and visualization
router = APIRouter(prefix="/team4/viz")

dataviz_llm_service = LLMDataVizService()

DATA_GOV_API_KEY=os.getenv("DATA_GOV_API_KEY", "")

ANALYSIS_MAX_ROWS  = 100_000
FETCH_PAGE_SIZE    = 2_000
MAX_DOWNLOAD_ROWS  = 100_000

# Save downloaded datasets next to uploaded files so downstream analysis works
_GOV_DOWNLOAD_DIR = _Path(RAW_DATA_DIR)
_GOV_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger(__name__)
# ── Data-viz request models ───────────────────────────────────────────────────

class VisualizeRequest(BaseModel):
    filename: str
    x_axis: str
    y_axis: str
    chart_type: str

class VisualIdeasRequest(BaseModel):
    filename: str
    max_ideas: int = 4

class RecommendRequest(BaseModel):
    columns: list
    column_stats: list


# ── Data-viz endpoints ────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_dataset(file: UploadFile = File(...)):
    """Saves the uploaded file and returns column info to the frontend."""
    try:
        filename = os.path.basename(file.filename)
        file_path = os.path.join(RAW_DATA_DIR, filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        dataset_info = get_dataset_info(filename)
        return {"message": "File uploaded", "data": dataset_info}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/preview")
async def preview_dataset(filename: str):
    """Returns first 100 rows and column statistics for a previously uploaded file."""
    try:
        return get_data_preview(filename)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/visualize")
async def visualize_dataset(request: VisualizeRequest):
    """Returns data formatted for charts."""
    try:
        return get_chart_data(request.filename, request.x_axis, request.y_axis, request.chart_type)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/recommend")
async def recommend_visuals(request: RecommendRequest):
    """Returns AI recommendations for visualizations based on column stats."""
    try:
        rec = dataviz_llm_service.get_recommendations(request.columns, request.column_stats)
        return {"recommendation": rec}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/visual-ideas")
async def visualize_ideas(request: VisualIdeasRequest):
    """Returns AI-suggested chart ideas based on dataset metadata."""
    try:
        payload = await get_visual_ideas(request.filename, request.max_ideas)
        return payload
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Visual idea generation failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/datasets")
async def list_datasets(q: str = "", offset: int = 0, limit: int = 20, sector: str = ""):
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
                    "name":     title,
                    "desc":     str(item.get("desc") or ""),
                    "category": str(category),
                    "org":      str(org_name),
                    "id":       index_name,
                    "updated":  str(item.get("updated") or item.get("date_last_updated") or ""),
                    "fields":   fields,
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


# 2. GET /team4/datasets/sample/{index_id} — preview rows
@router.get("/datasets/sample/{index_id:path}")
async def get_dataset_sample(index_id: str, limit: int = 500):
    """Fetch up to `limit` rows from a data.gov.in resource for in-browser preview."""
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


# 3. POST /team4/datasets/fetch-for-analysis — NDJSON stream download
class FetchForAnalysisRequest(BaseModel):
    index_id:     str
    dataset_name: str
    max_rows:     int = ANALYSIS_MAX_ROWS


@router.post("/datasets/fetch-for-analysis")
async def fetch_dataset_for_analysis(payload: FetchForAnalysisRequest):
    """Downloads full dataset server-to-server and writes a CSV to the uploads dir.
    Streams NDJSON progress events so the browser can show a live progress bar."""
    if not DATA_GOV_API_KEY:
        async def _err():
            yield json.dumps({"type": "error", "message": "DATA_GOV_API_KEY not configured"}) + "\n"
        return StreamingResponse(_err(), media_type="application/x-ndjson")

    max_rows  = min(payload.max_rows, ANALYSIS_MAX_ROWS)
    safe_base = _re.sub(r"[^\w\-]", "_", payload.dataset_name)[:50]
    filename  = f"{safe_base}_{_uuid.uuid4().hex[:8]}.csv"
    file_path = _GOV_DOWNLOAD_DIR / filename
    base_url  = f"https://api.data.gov.in/resource/{payload.index_id}"

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
                            if page_errors >= MAX_PAGE_ERRORS:
                                if rows_written == 0:
                                    file_path.unlink(missing_ok=True)
                                    yield json.dumps({"type": "error", "message": "data.gov.in timed out."}) + "\n"
                                    return
                                break
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
                                    yield json.dumps({"type": "error", "message": f"data.gov.in returned HTTP {status}."}) + "\n"
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
                            writer = _csv.DictWriter(fh, fieldnames=fieldnames,
                                                     extrasaction="ignore", lineterminator="\n")
                            writer.writeheader()
                            header_written = True

                        for record in records:
                            writer.writerow(record)  # type: ignore[union-attr]
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
        yield json.dumps({
            "type":            "complete",
            "filename":        filename,
            "rows_fetched":    rows_written,
            "total_available": total_available,
            "truncated":       truncated,
        }) + "\n"

    return StreamingResponse(_stream(), media_type="application/x-ndjson")


# 4. GET /team4/datasets/download/{index_id} — stream CSV to browser
@router.get("/datasets/download/{index_id:path}")
async def download_dataset_csv(index_id: str, filename: str = "dataset"):
    """Streams the full dataset from data.gov.in as a CSV file download.
    The API key stays server-side — never exposed to the browser."""
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
                        csv_writer = _csv.DictWriter(writer_buf, fieldnames=headers,
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
            "X-Accel-Buffering":   "no",
        },
    )


# 5. POST /team4/datasets/chat — AI chat about a dataset
class DatasetChatRequest(BaseModel):
    dataset_name: str
    description:  str
    fields:       list[dict] = []
    question:     str
    history:      list[dict] = []


@router.post("/datasets/chat")
async def chat_about_dataset(payload: DatasetChatRequest):
    """Answer a question about a data.gov.in dataset using its metadata as LLM context."""
    if not dataviz_llm_service.client:
        return {"answer": "Error: Azure OpenAI is not configured on this server.", "model": "fallback"}
    
    client = dataviz_llm_service.client
    model_name = dataviz_llm_service.deployment

    schema_lines = ""
    if payload.fields:
        schema_lines = "\n".join(
            f"  - {f.get('name', '?')} ({f.get('type', 'unknown')})"
            for f in payload.fields[:30]
        )
        schema_lines = f"\nSchema ({len(payload.fields)} columns):\n{schema_lines}"

    system = (
        "You are a data analyst specializing in Indian government open datasets. "
        "Answer questions about the dataset described below. "
        "Be specific, concise, and practical. Reference column names when relevant.\n\n"
        f"=== DATASET ===\n"
        f"Name: {payload.dataset_name}\n"
        f"Description: {payload.description[:800]}\n"
        f"{schema_lines}\n"
        "=== END ==="
    )

    messages = [{"role": "system", "content": system}]
    for turn in payload.history[-6:]:
        messages.append(turn)
    messages.append({"role": "user", "content": payload.question.strip()})

    try:
        resp = await client.chat.completions.create(
            model=model_name, messages=messages, temperature=0.3, max_tokens=600
        )
        return {"answer": resp.choices[0].message.content, "model": model_name}
    except Exception as exc:
        logger.error("dataset chat LLM error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))