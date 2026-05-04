"""
Data Harvester endpoint — extract structured dataset rows from documents
using chunked semantic search + Azure OpenAI.

Flow:
1. For each schema column, find relevant chunks via FAISS search
2. Deduplicate and rank chunks
3. Send only relevant chunks + schema to OpenAI
4. Parse and return extracted row(s)
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form

from modules.team3_ocr.api.dependencies import verify_auth, get_search_provider
from modules.team3_ocr.api.schemas.dataset_schemas import (
    DatasetExtractRequest,
    DatasetExtractResponse,
)
from modules.team3_ocr.api.routes.chat import _get_openai_client
from modules.team3_ocr.config import settings
from modules.team3_ocr.api.dependencies import get_blob_storage
from modules.team3_ocr.storage import BlobPaths

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/dataset",
    tags=["Team 3 - OCR"],
    dependencies=[Depends(verify_auth)],
)


EXTRACTION_SYSTEM_PROMPT = (
    "You are a precise data extraction assistant. You are given:\n"
    "1. A dataset SCHEMA (column names with optional descriptions and sample values)\n"
    "2. DOCUMENT CHUNKS extracted from a scanned/OCR'd document\n\n"
    "Your task: Extract ALL possible rows of data that match the schema from the document chunks.\n"
    "Each row should be a JSON object where keys are the exact column names from the schema.\n\n"
    "Rules:\n"
    "- Return a JSON array of objects (even if only one row is found).\n"
    "- Each object's keys MUST exactly match the column names provided.\n"
    "- If a value cannot be determined for a column, use null.\n"
    "- Extract ALL distinct rows you can find — do not stop at one.\n"
    "- Do NOT invent data. Only extract what is explicitly present in the chunks.\n"
    "- Return ONLY the JSON array. No markdown fences, no explanation, no extra text.\n"
)


@router.post("/extract-row", response_model=DatasetExtractResponse)
async def extract_dataset_row(request: DatasetExtractRequest):
    """
    Extract dataset rows from a processed document using chunked semantic search.

    1. For each schema column, search the document's FAISS index for relevant chunks
    2. Deduplicate and rank the retrieved chunks
    3. Send the relevant chunks + schema to Azure OpenAI
    4. Return the extracted row(s)
    """
    search = get_search_provider()

    # ── Step 1: Retrieve relevant chunks per schema column ────────────────────
    all_chunks = []
    for col in request.schema:
        # Build a rich search query from column metadata
        query_parts = [col.name]
        if col.description:
            query_parts.append(col.description)
        if col.sample_values:
            # Include up to 2 sample values for better semantic matching
            query_parts.extend(col.sample_values[:2])
        query = " ".join(query_parts)

        try:
            chunks = await search.search_document(
                doc_id=request.document_id,
                query=query,
                top_k=4,
            )
            for c in chunks:
                c["source_column"] = col.name  # Track which column triggered this
            all_chunks.extend(chunks)
        except Exception as e:
            logger.warning(f"Search failed for column '{col.name}': {e}")
            continue

    if not all_chunks:
        return DatasetExtractResponse(
            rows=[],
            chunks_used=0,
            message="No relevant content found in the document for any of the schema columns. "
                    "Ensure the document has been processed and indexed first.",
        )

    # ── Step 2: Deduplicate chunks by text, keep highest score ────────────────
    seen = set()
    unique_chunks = []
    for c in sorted(all_chunks, key=lambda x: x.get("score", 0), reverse=True):
        snippet = c["text_snippet"]
        if snippet not in seen:
            seen.add(snippet)
            unique_chunks.append(c)

    # Cap at 15 chunks to stay within token limits
    unique_chunks = unique_chunks[:15]

    # ── Step 3: Build context and schema description ──────────────────────────
    context_block = "\n\n".join(
        f"[Chunk {i + 1}] (relevance: {c.get('score', 'N/A')}):\n{c['text_snippet']}"
        for i, c in enumerate(unique_chunks)
    )

    schema_lines = []
    for col in request.schema:
        line = f"- {col.name}"
        if col.description:
            line += f" ({col.description})"
        if col.sample_values:
            line += f" [examples: {', '.join(col.sample_values[:3])}]"
        schema_lines.append(line)
    schema_desc = "\n".join(schema_lines)

    # ── Step 4: Call Azure OpenAI ─────────────────────────────────────────────
    client, deployment = _get_openai_client()

    if client is None:
        # Graceful fallback — return empty with a message
        return DatasetExtractResponse(
            rows=[],
            chunks_used=len(unique_chunks),
            message="Azure OpenAI is not configured. Cannot perform AI extraction. "
                    "Please configure AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, and "
                    "AZURE_OPENAI_DEPLOYMENT in your .env file.",
        )

    user_prompt = (
        f"Dataset Schema:\n{schema_desc}\n\n"
        f"Document Chunks:\n{context_block}\n\n"
        f"Extract ALL rows of data matching the schema above. Return as a JSON array."
    )
    if request.filename:
        user_prompt = f"Document: {request.filename}\n\n" + user_prompt

    messages = [
        {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    try:
        import asyncio

        def _call_openai():
            response = client.chat.completions.create(
                model=deployment,
                temperature=0.1,  # Low temp for precise extraction
                max_tokens=2048,
                messages=messages,
            )
            return response.choices[0].message.content or "[]"

        raw_response = await asyncio.to_thread(_call_openai)
    except Exception as e:
        logger.error(f"Azure OpenAI extraction failed: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Failed to get response from Azure OpenAI: {str(e)}",
        )

    # ── Step 5: Parse the JSON response ───────────────────────────────────────
    rows, parse_message = _parse_extraction_response(raw_response, request.schema)

    message = parse_message or f"Extracted {len(rows)} row(s) from {len(unique_chunks)} relevant chunks."

    # Persist extraction output to Blob Storage (best-effort) for the processed dataset folder.
    if settings.storage_provider == "azure":
        blob = get_blob_storage()
        if blob.is_available():
            try:
                paths = BlobPaths()
                extraction_id = str(uuid.uuid4())
                ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
                blob_name = f"{paths.processed_doc_prefix(request.document_id)}data_harvester/{ts}_{extraction_id}.json"
                blob.upload_bytes(
                    blob_name,
                    json.dumps(
                        {
                            "document_id": request.document_id,
                            "filename": request.filename,
                            "schema": [c.model_dump() for c in request.schema],
                            "chunks_used": len(unique_chunks),
                            "rows": rows,
                            "raw_model_response": raw_response if settings.debug else None,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        },
                        ensure_ascii=False,
                        indent=2,
                    ).encode("utf-8"),
                    content_type="application/json",
                )
            except Exception:
                pass

    return DatasetExtractResponse(
        rows=rows,
        chunks_used=len(unique_chunks),
        message=message,
        raw_model_response=(raw_response[:4000] if settings.debug and raw_response else None),
        chunks_preview=(
            [{"text_snippet": c.get("text_snippet", "")[:600], "score": str(c.get("score"))} for c in unique_chunks]
            if settings.debug else None
        ),
    )


def _parse_extraction_response(raw: str, schema: list) -> tuple[list, str | None]:
    """
    Parse the OpenAI response into a list of row dicts.
    Handles various response formats (array, single object, markdown-wrapped).
    """
    column_names = [col.name for col in schema]

    # Strip markdown code fences if present
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        # Remove ```json ... ``` wrapper
        lines = cleaned.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()

    parsed = None
    parse_message = None
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        # Try to salvage a JSON array/object embedded in surrounding text.
        candidate = _extract_json_substring(cleaned)
        if candidate:
            try:
                parsed = json.loads(candidate)
            except json.JSONDecodeError:
                parsed = None

    if parsed is None:
        # Fallback: python literal (handles single quotes / None) without executing code.
        try:
            import ast
            parsed = ast.literal_eval(cleaned)
        except Exception:
            logger.warning(f"Failed to parse extraction response as JSON: {cleaned[:200]}")
            return [], "AI returned an invalid JSON payload; no rows could be parsed."

    # Normalize to a list of dicts
    if isinstance(parsed, dict):
        parsed = [parsed]
    elif not isinstance(parsed, list):
        return [], "AI response was not a JSON object/array; no rows could be parsed."

    # Validate and normalize each row
    validated_rows = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        # Ensure all schema columns exist in the row
        row = {}
        for col_name in column_names:
            value = item.get(col_name)
            row[col_name] = str(value) if value is not None else None
        # Only include rows that have at least one non-null value
        if any(v is not None for v in row.values()):
            validated_rows.append(row)

    if not validated_rows and isinstance(parsed, list) and parsed:
        parse_message = "AI returned only empty/null rows; nothing to extract from the provided chunks."

    return validated_rows, parse_message


def _extract_json_substring(text: str) -> str | None:
    """
    Attempt to extract the first JSON array/object substring from free-form text.
    Example: model returns explanation + JSON; we salvage the JSON portion.
    """
    if not text:
        return None

    first_array = text.find("[")
    last_array = text.rfind("]")
    if first_array != -1 and last_array != -1 and last_array > first_array:
        return text[first_array:last_array + 1].strip()

    first_obj = text.find("{")
    last_obj = text.rfind("}")
    if first_obj != -1 and last_obj != -1 and last_obj > first_obj:
        return text[first_obj:last_obj + 1].strip()

    return None


def _safe_blob_token(value: str) -> str:
    cleaned = "".join(c for c in (value or "") if c.isalnum() or c in ("-", "_", ".", " ")).strip()
    cleaned = cleaned.replace(" ", "_")
    return cleaned or "file"


@router.post("/store-to-blob", response_model=dict)
async def store_data_harvester_files_to_blob(
    document_id: str = Form(...),
    raw_file: UploadFile = File(...),
    processed_file: UploadFile = File(...),
):
    """
    Persist the Data Harvester's dataset artifacts to Blob Storage.

    Stores:
    - raw uploaded dataset file (csv/xlsx) under uploads/raw_data_harvester/raw/<document_id>/...
    - processed/enriched dataset (csv) under uploads/processed_data_harvester/processed/<document_id>/...
    """
    if settings.storage_provider != "azure":
        raise HTTPException(400, "Blob storage is not enabled. Set STORAGE_PROVIDER=azure.")

    blob = get_blob_storage()
    if not blob.is_available():
        raise HTTPException(400, "Azure Blob Storage is not configured/available on the backend.")

    paths = BlobPaths()
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_doc_id = _safe_blob_token(document_id)

    raw_name = f"{ts}_{_safe_blob_token(raw_file.filename)}"
    processed_name = f"{ts}_{_safe_blob_token(processed_file.filename)}"

    raw_bytes = await raw_file.read()
    processed_bytes = await processed_file.read()

    raw_blob = paths.harvester_raw_blob_name(safe_doc_id, raw_name)
    processed_blob = paths.harvester_processed_blob_name(safe_doc_id, processed_name)

    blob.upload_bytes(raw_blob, raw_bytes, content_type=raw_file.content_type or "application/octet-stream")
    blob.upload_bytes(processed_blob, processed_bytes, content_type=processed_file.content_type or "text/csv")

    # Optional metadata record
    try:
        meta_blob = paths.harvester_processed_blob_name(safe_doc_id, f"{ts}_metadata.json")
        blob.upload_bytes(
            meta_blob,
            json.dumps(
                {
                    "document_id": document_id,
                    "raw_filename": raw_file.filename,
                    "processed_filename": processed_file.filename,
                    "stored_at": datetime.now(timezone.utc).isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            ).encode("utf-8"),
            content_type="application/json",
        )
    except Exception:
        pass

    return {"success": True, "raw_blob": raw_blob, "processed_blob": processed_blob}
