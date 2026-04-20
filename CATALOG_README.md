# Data Catalog Feature — Plug-In Guide

A self-contained integration for browsing, previewing, downloading, and AI-analyzing 277k+ Indian government datasets from [data.gov.in](https://data.gov.in) inside a React + FastAPI app.

---

## What it does

| Feature | Description |
|---|---|
| **Catalog Browser** | Infinite-scroll list of Central Government datasets, searchable + filterable by sector chip |
| **Dataset Side Panel** | Three-tab hub: Overview (schema + metadata), Data Preview (live sample rows), AI Insights (LLM chat) |
| **Full Dataset Download** | Streams CSV to the browser via a server-side paginating proxy — API key never exposed |
| **Server-to-Server Fetch** | Downloads the full dataset (up to 100k rows) into a backend workspace for deeper analysis, with real-time NDJSON progress |
| **AI Chat** | Ask natural-language questions about any dataset using its metadata + schema as LLM context |

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Python 3.10+** with FastAPI | Any FastAPI app works — just mount the router |
| **httpx** | `pip install httpx` — async HTTP for proxying data.gov.in |
| **openai** (Python SDK) | `pip install openai` — used for Groq/NVIDIA LLM calls |
| **pydantic-settings** | `pip install pydantic-settings` — for typed settings / `.env` loading |
| **React 18 + TypeScript** | Any Vite/CRA React project |
| **lucide-react** | `npm install lucide-react` — icons used in CatalogView and DatasetDetailsHub |
| **data.gov.in API key** | Free registration at [data.gov.in/register](https://data.gov.in/user/register) |
| **Groq or NVIDIA API key** | For AI chat. Groq free tier works fine. [console.groq.com](https://console.groq.com) |

---

## Repository Layout (what to copy)

```
your-project/
├── backend/
│   └── router.py              ← add the 5 catalog endpoints (Section 2)
├── frontend/src/
│   └── catalog/
│       ├── services.ts        ← API call functions (Section 3)
│       ├── CatalogView.tsx    ← browseable catalog UI (Section 4)
│       └── DatasetDetailsHub.tsx  ← side panel UI (Section 5)
└── .env                       ← DATA_GOV_API_KEY, GROQ_API_KEY
```

---

## Step 1 — Environment Variables

Add to your `.env`:

```env
# data.gov.in Open Data Platform
DATA_GOV_API_KEY=579b464db66ec23bdd000001809082399ab84dc572762e93263648ec
```

---

## Step 2 — Backend: FastAPI Endpoints

Add these 5 endpoints to your FastAPI router. The only dependency is `httpx` and `openai` (for chat). **Adapt the `_T4_DIR` path** to wherever your app writes uploaded files — or remove the `fetch-for-analysis` endpoint if you don't need server-side analysis integration.

```python
# ============================================================
# CATALOG BACKEND — add to your FastAPI router
# Requires: pip install httpx openai pydantic-settings
# ============================================================

import asyncio
import csv as _csv
import io
import json
import logging
import re as _re
import uuid as _uuid
from pathlib import Path as _Path

import httpx
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ── Tune these to match your setup ──────────────────────────
DATA_GOV_API_KEY = ""          # or pull from settings/env
GROQ_API_KEY     = ""          # or settings.groq_api_key
GROQ_MODEL       = "llama-3.3-70b-versatile"
NVIDIA_API_KEY   = ""          # optional; leave blank to use Groq
NVIDIA_MODEL     = "meta/llama-3.3-70b-instruct"

ANALYSIS_MAX_ROWS = 100_000    # ceiling for server-side fetch
FETCH_PAGE_SIZE   = 2_000      # rows per data.gov.in page

# Where to save the downloaded CSV for downstream analysis.
# Set to None if you don't need server-side analysis integration.
_UPLOAD_DIR = _Path("./uploads")
_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ── Helper: LLM client ──────────────────────────────────────
def _get_llm_client():
    """Returns (AsyncOpenAI client, model_name). Prefers NVIDIA, falls back to Groq."""
    from openai import AsyncOpenAI
    if NVIDIA_API_KEY:
        return (
            AsyncOpenAI(base_url="https://integrate.api.nvidia.com/v1", api_key=NVIDIA_API_KEY),
            NVIDIA_MODEL,
        )
    return (
        AsyncOpenAI(base_url="https://api.groq.com/openai/v1", api_key=GROQ_API_KEY),
        GROQ_MODEL,
    )


# ─────────────────────────────────────────────────────────────
# 1. GET /datasets — catalog listing
# ─────────────────────────────────────────────────────────────
@router.get("/datasets")
async def list_datasets(q: str = "", offset: int = 0, limit: int = 20, sector: str = ""):
    """
    Proxy to data.gov.in catalog API.
    Returns { total, results: [{name, desc, category, org, id, updated, fields}] }
    """
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


# ─────────────────────────────────────────────────────────────
# 2. GET /datasets/sample/{index_id} — preview rows
# ─────────────────────────────────────────────────────────────
@router.get("/datasets/sample/{index_id:path}")
async def get_dataset_sample(index_id: str, limit: int = 500):
    """
    Fetch up to `limit` rows from a data.gov.in resource for in-browser preview.
    Returns { records: [...], field: [...], total: int }
    """
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


# ─────────────────────────────────────────────────────────────
# 3. POST /datasets/fetch-for-analysis — NDJSON stream download
# ─────────────────────────────────────────────────────────────
class FetchForAnalysisRequest(BaseModel):
    index_id:     str
    dataset_name: str
    max_rows:     int = ANALYSIS_MAX_ROWS


@router.post("/datasets/fetch-for-analysis")
async def fetch_dataset_for_analysis(payload: FetchForAnalysisRequest):
    """
    Downloads the full dataset server-to-server from data.gov.in and writes
    it to _UPLOAD_DIR as a CSV. Streams NDJSON progress events so the
    browser can show a live progress bar.

    Event types:
      {"type": "progress", "rows_fetched": int, "total": int|null, "pct": int}
      {"type": "complete", "filename": str, "rows_fetched": int,
                           "total_available": int|null, "truncated": bool}
      {"type": "error",   "message": str}
    """
    if not DATA_GOV_API_KEY:
        async def _err():
            yield json.dumps({"type": "error", "message": "DATA_GOV_API_KEY not configured"}) + "\n"
        return StreamingResponse(_err(), media_type="application/x-ndjson")

    max_rows  = min(payload.max_rows, ANALYSIS_MAX_ROWS)
    safe_base = _re.sub(r"[^\w\-]", "_", payload.dataset_name)[:50]
    filename  = f"{safe_base}_{_uuid.uuid4().hex[:8]}.csv"
    file_path = _UPLOAD_DIR / filename
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
                            writer = _csv.DictWriter(fh, fieldnames=fieldnames,
                                                     extrasaction="ignore", lineterminator="\n")
                            writer.writeheader()
                            header_written = True

                        for record in records:
                            writer.writerow(record)   # type: ignore[union-attr]
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


# ─────────────────────────────────────────────────────────────
# 4. GET /datasets/download/{index_id} — stream CSV to browser
# ─────────────────────────────────────────────────────────────
MAX_DOWNLOAD_ROWS = 100_000

@router.get("/datasets/download/{index_id:path}")
async def download_dataset_csv(index_id: str, filename: str = "dataset"):
    """
    Streams the full dataset from data.gov.in as a CSV file download.
    The API key stays server-side — never exposed to the browser.
    Capped at MAX_DOWNLOAD_ROWS rows.
    """
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


# ─────────────────────────────────────────────────────────────
# 5. POST /datasets/chat — AI chat about a dataset
# ─────────────────────────────────────────────────────────────
class DatasetChatRequest(BaseModel):
    dataset_name: str
    description:  str
    fields:       list[dict] = []
    question:     str
    history:      list[dict] = []   # [{role, content}] — last N turns


@router.post("/datasets/chat")
async def chat_about_dataset(payload: DatasetChatRequest):
    """Answer a question about a data.gov.in dataset using its metadata as LLM context."""
    client, model_name = _get_llm_client()

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
```

---

## Step 3 — Frontend: TypeScript Service Functions

Create `catalog/services.ts` (or add to your existing services file):

```typescript
// ============================================================
// CATALOG SERVICES — data.gov.in API wrappers
// Adjust BASE_URL to match your backend
// ============================================================

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8742';

export interface DatasetEntry {
  name:     string;
  desc:     string;
  category: string;
  org:      string;
  id?:      string;
  fields?:  Array<{ name: string; type?: string }>;
  updated?: string;
}

export interface DatasetPage {
  total:   number;
  results: DatasetEntry[];
  error?:  string;
}

export interface FetchProgressEvent {
  rows_fetched: number;
  total:        number | null;
  pct:          number;
}

export interface FetchForAnalysisResult {
  filename:        string;
  rows_fetched:    number;
  total_available: number | null;
  truncated:       boolean;
}

/** Paginated catalog listing */
export async function fetchDatasets(
  q: string, offset: number, limit: number, sector = ''
): Promise<DatasetPage> {
  const params = new URLSearchParams({ q, offset: String(offset), limit: String(limit), sector });
  const res = await fetch(`${BASE_URL}/datasets?${params}`);
  if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
  return res.json();
}

/** Sample rows for in-browser preview */
export async function fetchDatasetSample(
  indexId: string
): Promise<{ records: any[]; [key: string]: any }> {
  const res = await fetch(`${BASE_URL}/datasets/sample/${encodeURIComponent(indexId)}`);
  if (!res.ok) throw new Error(`Sample fetch failed: ${res.status}`);
  return res.json();
}

/**
 * Downloads the full dataset server-to-server and saves it to the backend workspace.
 * Streams NDJSON progress events — call onProgress to update UI in real time.
 */
export async function fetchDatasetForAnalysis(
  indexId:      string,
  datasetName:  string,
  onProgress?:  (e: FetchProgressEvent) => void,
  maxRows = 100_000,
): Promise<FetchForAnalysisResult> {
  const res = await fetch(`${BASE_URL}/datasets/fetch-for-analysis`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ index_id: indexId, dataset_name: datasetName, max_rows: maxRows }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `Fetch failed: ${res.status}`);
  }

  const reader  = res.body?.getReader();
  if (!reader) throw new Error('No response stream');

  const decoder = new TextDecoder();
  let   buffer  = '';
  let   result: FetchForAnalysisResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'progress') {
          onProgress?.({ rows_fetched: event.rows_fetched, total: event.total, pct: event.pct });
        } else if (event.type === 'complete') {
          result = {
            filename:        event.filename,
            rows_fetched:    event.rows_fetched,
            total_available: event.total_available,
            truncated:       event.truncated,
          };
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }

  if (!result) throw new Error('Dataset fetch completed without a result event.');
  return result;
}

/** Trigger a full CSV download to the browser (API key stays server-side) */
export function downloadDatasetCSV(indexId: string, datasetName: string): void {
  const safeName = encodeURIComponent(datasetName.slice(0, 60));
  const url = `${BASE_URL}/datasets/download/${encodeURIComponent(indexId)}?filename=${safeName}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `${datasetName.slice(0, 60)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** AI chat about a dataset using its metadata as LLM context */
export async function chatAboutDataset(
  name: string, desc: string, fields: any[], question: string, history: any[] = []
): Promise<{ answer: string }> {
  const res = await fetch(`${BASE_URL}/datasets/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ dataset_name: name, description: desc, fields, question, history }),
  });
  if (!res.ok) throw new Error(`Chat failed: ${res.status}`);
  return res.json();
}
```

---

## Step 4 — Frontend: CatalogView Component

Create `catalog/CatalogView.tsx`. This is the main browseable list with infinite scroll, search, and sector filter chips.

```tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { Search } from 'lucide-react';
import { fetchDatasets, DatasetEntry } from './services';
import DatasetDetailsHub from './DatasetDetailsHub';

interface Props {
  /** Called when a dataset is selected — useful for integrating with other views */
  onSelect?: (id: string) => void;
  /** Called when "Analyze Full Dataset" is clicked in the hub */
  onAnalyzeDataset?: (dataset: DatasetEntry) => void;
}

const PAGE_SIZE = 50;

const CatalogView = ({ onSelect, onAnalyzeDataset }: Props) => {
  const [search,          setSearch]          = useState('');
  const [selected,        setSelected]        = useState<DatasetEntry | null>(null);
  const [datasets,        setDatasets]        = useState<DatasetEntry[]>([]);
  const [datasetsTotal,   setDatasetsTotal]   = useState(0);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [datasetsOffset,  setDatasetsOffset]  = useState(0);
  const [activeCategory,  setActiveCategory]  = useState<string | null>(null);
  const [hasMore,         setHasMore]         = useState(true);
  const [error,           setError]           = useState<string | null>(null);

  // ── Infinite scroll ──────────────────────────────────────
  const observer = useRef<IntersectionObserver | null>(null);
  const lastElementRef = useCallback((node: HTMLDivElement) => {
    if (datasetsLoading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        setDatasetsOffset(prev => prev + PAGE_SIZE);
      }
    });
    if (node) observer.current.observe(node);
  }, [datasetsLoading, hasMore]);

  // Derive category chips from currently loaded results
  const categories = Array.from(new Set(datasets.map(d => d.category))).slice(0, 10);

  const loadDatasets = async (query: string, category: string, offset: number) => {
    setDatasetsLoading(true);
    setError(null);
    try {
      const page = await fetchDatasets(query, offset, PAGE_SIZE, category);
      if (page.error) { setError(page.error); return; }
      setDatasetsTotal(page.total);
      setDatasets(prev => offset === 0 ? page.results : [...prev, ...page.results]);
      setHasMore(offset + PAGE_SIZE < page.total);
    } catch (err: any) {
      setError(err.message || 'Failed to connect to repository server');
    } finally {
      setDatasetsLoading(false);
    }
  };

  // Reset + reload when search or sector changes (400ms debounce on search)
  useEffect(() => {
    if (search.trim()) setActiveCategory(null);
    setDatasetsOffset(0);
    const t = setTimeout(() => loadDatasets(search, activeCategory || '', 0), search ? 400 : 0);
    return () => clearTimeout(t);
  }, [search, activeCategory]);

  // Load next page on scroll
  useEffect(() => {
    if (datasetsOffset > 0) loadDatasets(search, activeCategory || '', datasetsOffset);
  }, [datasetsOffset]);

  return (
    <div style={{ display: 'flex', gap: '20px', position: 'relative', minHeight: '600px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2>Explore Dataset Catalog</h2>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: '12px' }}>
          <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
          <input
            placeholder="Search datasets..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: '36px', paddingRight: search ? '40px' : '12px', padding: '10px 40px 10px 36px', borderRadius: '8px', background: 'rgba(30,41,59,0.6)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', fontSize: '14px', boxSizing: 'border-box' }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}>✕</button>
          )}
        </div>

        {/* Sector chips */}
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '10px', scrollbarWidth: 'none' }}>
          {['All Sectors', ...categories].map(cat => (
            <button
              key={cat}
              onClick={() => {
                if (cat === 'All Sectors') { setActiveCategory(null); }
                else { setSearch(''); setActiveCategory(activeCategory === cat ? null : cat); }
              }}
              style={{
                padding: '4px 12px', borderRadius: '20px', fontSize: '11px', whiteSpace: 'nowrap', cursor: 'pointer',
                background: (cat === 'All Sectors' ? !activeCategory : activeCategory === cat) ? 'rgba(251,140,54,0.2)' : 'rgba(30,41,59,0.4)',
                color:      (cat === 'All Sectors' ? !activeCategory : activeCategory === cat) ? '#fb8c36' : '#94a3b8',
                border:     (cat === 'All Sectors' ? !activeCategory : activeCategory === cat) ? '1px solid rgba(251,140,54,0.4)' : '1px solid rgba(255,255,255,0.1)',
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 12px' }}>
          {datasetsLoading && datasets.length === 0
            ? 'Connecting to repository…'
            : error
              ? `Error: ${error}`
              : `${datasetsTotal.toLocaleString()} datasets`}
        </p>

        {/* Dataset list */}
        <div>
          {datasets.length === 0 && datasetsLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ padding: '16px', marginBottom: '8px', background: 'rgba(30,41,59,0.4)', borderRadius: '8px', opacity: 0.6 }}>
                  <div style={{ width: '60%', height: '14px', background: '#334155', borderRadius: '4px', marginBottom: '8px' }} />
                  <div style={{ width: '80%', height: '10px', background: '#1e293b', borderRadius: '4px' }} />
                </div>
              ))
            : datasets.map((d, i) => (
                <div
                  key={`${d.name}-${i}`}
                  ref={i === datasets.length - 1 ? lastElementRef : null}
                  onClick={() => { setSelected(d); onSelect?.(d.id || d.name); }}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '14px 16px', marginBottom: '6px', borderRadius: '8px', cursor: 'pointer',
                    background: selected?.name === d.name ? 'rgba(251,140,54,0.08)' : 'rgba(30,41,59,0.4)',
                    border: `1px solid ${selected?.name === d.name ? 'rgba(251,140,54,0.3)' : 'rgba(255,255,255,0.05)'}`,
                    transition: 'all 0.15s',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9', marginBottom: '4px' }}>{d.name}</div>
                    <div style={{ fontSize: '11px', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '500px' }}>{d.desc}</div>
                  </div>
                  <span style={{ fontSize: '10px', padding: '3px 10px', borderRadius: '20px', background: 'rgba(251,140,54,0.1)', color: '#fb8c36', border: '1px solid rgba(251,140,54,0.2)', whiteSpace: 'nowrap', marginLeft: '12px', flexShrink: 0 }}>
                    {d.category}
                  </span>
                </div>
              ))
          }
          {datasetsLoading && datasets.length > 0 && (
            <div style={{ textAlign: 'center', padding: '16px', color: '#64748b', fontSize: '13px' }}>
              Loading more…
            </div>
          )}
        </div>
        {!hasMore && datasets.length > 0 && (
          <p style={{ textAlign: 'center', fontSize: '12px', color: '#475569', marginTop: '16px' }}>— End of results —</p>
        )}
      </div>

      {/* Side panel */}
      {selected && (
        <DatasetDetailsHub
          dataset={selected}
          onClose={() => setSelected(null)}
          onAnalyze={onAnalyzeDataset}
        />
      )}
    </div>
  );
};

export default CatalogView;
```

---

## Step 5 — Frontend: DatasetDetailsHub Component

Create `catalog/DatasetDetailsHub.tsx`. This is the slide-in side panel with Overview / Data Preview / AI Insights tabs.

The full source is in `frontend/src/pages/data-exchange/tools/data-viz/components/DatasetDetailsHub.tsx`. Copy it verbatim — it is fully self-contained with all CSS scoped inside a `<style>` tag, so it works without any global stylesheet.

The only imports it needs:
```tsx
import React, { useState, useEffect } from 'react';
import { X, Database, Calendar, Layers, MessageSquare, Table as TableIcon,
         Send, Loader2, Download } from 'lucide-react';
import { DatasetEntry, fetchDatasetSample, chatAboutDataset, downloadDatasetCSV }
  from './services';
```

---

## Step 6 — Mount in your React App

```tsx
// YourPage.tsx
import CatalogView from './catalog/CatalogView';
import { DatasetEntry } from './catalog/services';

const YourPage = () => {
  const handleAnalyze = (dataset: DatasetEntry) => {
    // Called when user clicks "Analyze Full Dataset"
    // The backend has already saved the CSV to _UPLOAD_DIR —
    // trigger your analysis pipeline here using dataset.id or dataset.name
    console.log('Analyze:', dataset.name, dataset.id);
  };

  return (
    <div style={{ padding: '24px' }}>
      <CatalogView onAnalyzeDataset={handleAnalyze} />
    </div>
  );
};
```

---

## Step 7 — Mount the FastAPI Router

```python
# main.py
from fastapi import FastAPI
from your_module.catalog_router import router as catalog_router

app = FastAPI()
app.include_router(catalog_router, prefix="/team5")  # or any prefix you choose
```

> **Important:** update the `BASE_URL` prefix in `services.ts` to match (e.g. `/api` or `/team5`).

---

## Architecture Overview

```
Browser                          FastAPI Backend              data.gov.in
  │                                    │                           │
  │── GET /datasets?q=...  ──────────► │── GET /lists?...  ──────► │
  │◄── { total, results[] } ──────────│◄── { records[] } ─────────│
  │                                    │
  │── GET /datasets/sample/{id} ─────► │── GET /resource/{id}?limit=500
  │◄── { records, field, total } ─────│◄─────────────────────────────
  │                                    │
  │── POST /datasets/fetch-for-analysis│
  │   { index_id, dataset_name }  ───► │── pages through resource API
  │◄── NDJSON stream: ─────────────── │   (2000 rows/page, up to 100k)
  │    progress…progress…complete      │── writes CSV → _UPLOAD_DIR/
  │                                    │
  │── GET /datasets/download/{id} ───► │── streams CSV via chunked encoding
  │◄── text/csv attachment ───────────│   (API key stays server-side)
  │                                    │
  │── POST /datasets/chat ───────────► │── metadata → Groq/NVIDIA LLM
  │◄── { answer } ────────────────────│◄── LLM response
```

---

## Adapting for Your Project

| What to change | Where |
|---|---|
| `BASE_URL` / route prefix | `services.ts` line 1 |
| `DATA_GOV_API_KEY` / LLM keys | `.env` + router constants |
| `_UPLOAD_DIR` | Router — set to wherever your analysis pipeline reads from |
| `ANALYSIS_MAX_ROWS` | Router — lower if memory-constrained (10k is fine for most LLMs) |
| CSS class names (`.xt-*`) | `CatalogView.tsx` — these come from our global ToolPage.css; replace with your own or inline styles |
| Orange accent colour `#fb8c36` | Search/replace across both TSX files if you want a different palette |
| `filters[org_type]=Central` | `list_datasets()` — remove this to include State-level datasets too |

---

## CSS Dependencies

`CatalogView.tsx` uses a few CSS classes from the host app (`xt-dataset-row`, `xt-dataset-name`, etc.). If you don't have them, either:

**Option A** — Add a minimal stylesheet:
```css
.xt-dataset-row { display:flex; justify-content:space-between; align-items:center; padding:14px 16px; margin-bottom:6px; border-radius:8px; cursor:pointer; background:rgba(30,41,59,0.4); border:1px solid rgba(255,255,255,0.05); transition:all 0.15s; }
.xt-dataset-row:hover, .xt-dataset-row.selected { background:rgba(251,140,54,0.08); border-color:rgba(251,140,54,0.3); }
.xt-dataset-name { font-size:13px; font-weight:600; color:#f1f5f9; display:block; margin-bottom:4px; }
.xt-dataset-desc { font-size:11px; color:#64748b; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:500px; }
.xt-dataset-badge { font-size:10px; padding:3px 10px; border-radius:20px; background:rgba(251,140,54,0.1); color:#fb8c36; border:1px solid rgba(251,140,54,0.2); white-space:nowrap; flex-shrink:0; }
```

**Option B** — Use the fully inline-styled version of `CatalogView.tsx` included in Step 4 above (already uses inline styles, no class names).

`DatasetDetailsHub.tsx` is already fully self-contained — all styles are scoped in its own `<style>` block.

---

## Quick Test

```bash
# 1. Verify catalog listing
curl "http://localhost:8742/team5/datasets?limit=5" | python3 -m json.tool

# 2. Verify sample preview
curl "http://localhost:8742/team5/datasets/sample/37670b6f-c236-49a7-8cd7-cc2dc610e32d?limit=3" | python3 -m json.tool

# 3. Verify AI chat
curl -s -X POST http://localhost:8742/team5/datasets/chat \
  -H "Content-Type: application/json" \
  -d '{"dataset_name":"Hospital Directory","description":"National hospital data","fields":[{"name":"state","type":"keyword"}],"question":"What states are covered?"}' \
  | python3 -m json.tool

# 4. Verify NDJSON fetch stream
curl -s -X POST http://localhost:8742/team5/datasets/fetch-for-analysis \
  -H "Content-Type: application/json" \
  -d '{"index_id":"37670b6f-c236-49a7-8cd7-cc2dc610e32d","dataset_name":"Hospital Directory","max_rows":100}'
```

---

## FAQ

**Q: Does the browser ever see the API key?**
No. All requests to `api.data.gov.in` are made server-side. The browser only talks to your FastAPI backend.

**Q: What happens if a dataset has 500k rows?**
The fetch-for-analysis endpoint caps at `ANALYSIS_MAX_ROWS = 100_000`. The download endpoint also caps at `MAX_DOWNLOAD_ROWS = 100_000`. For most LLM/stats workflows 100k rows is more than sufficient.

**Q: Can I change 100k to something else?**
Yes — lower `ANALYSIS_MAX_ROWS` and `MAX_DOWNLOAD_ROWS` freely. For LLM analysis, even 5k rows usually gives a representative sample.

**Q: Does it work with State-level datasets?**
Yes — remove `"filters[org_type]": "Central"` from the `list_datasets` params to include all dataset types.

**Q: What LLM does the chat use?**
NVIDIA NIM (`meta/llama-3.3-70b-instruct`) if `NVIDIA_API_KEY` is set, otherwise Groq (`llama-3.3-70b-versatile`). Both are OpenAI-compatible.

**Q: Why NDJSON for the fetch stream instead of WebSockets?**
NDJSON (newline-delimited JSON) over HTTP chunked encoding is simpler to implement, requires no persistent connection management, and works through all standard reverse proxies. It's the same pattern used by OpenAI's streaming API.
