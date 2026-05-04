from fastapi import APIRouter, UploadFile, File, HTTPException, Form, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
import os
import json
import logging
import pandas as pd
import io
import re
import base64
import math
import mimetypes
from urllib.parse import quote
from pathlib import Path

logger = logging.getLogger(__name__)

from .services import AzureBlobStorageService, AzureDocIntelService, LLMPIIService, StructuredDataEngine, PresidioService, ImageRedactorService
from .audio_service import AudioRedactorService
from .utils import configuration, POLICY_METADATA

router = APIRouter(prefix="/team4")
SAMPLE_DIR = (Path(__file__).resolve().parent / "sample").resolve()

@router.get("/health")
async def team4_health():
    """Diagnostic endpoint to verify router registration."""
    return {
        "status": "healthy",
        "module": "team4_anonymization",
        "api_key_set": bool(os.environ.get("DATA_GOV_API_KEY")),
        "azure_configured": bool(os.getenv("AZURE_STORAGE_ACCOUNT_NAME"))
    }

# Initialize services
blob_service = AzureBlobStorageService()
doc_intel_service = AzureDocIntelService()
llm_service = LLMPIIService()
structured_engine = StructuredDataEngine()
presidio = PresidioService(configuration)
image_redactor = ImageRedactorService(fill_color=(0, 0, 0))  # black redaction boxes
audio_redactor = AudioRedactorService()

def resolve_blob_url(path: str):
    """
    Helper to return a reachable URL regardless of storage backend.
    """
    if not path or "failure" in path or "error" in path:
        return path
        
    if path.startswith("local_file:"):
        filename = path.split(":", 1)[1]
        # Using localhost for simplicity in local dev setup
        return f"http://localhost:8766/static/anonymization/{filename}"
    
    # If it's a standard blob path like 'Team4AnonymizationOutputs/file.pdf' or old 'anonymization/file', construct Azure URL
    if "/" in path and not path.startswith("http"):
        account_name = os.getenv("AZURE_STORAGE_ACCOUNT_NAME", "")
        container_name = os.getenv("AZURE_BLOB_CONTAINER_NAME", "aikosh-v2")
        return f"https://{account_name}.blob.core.windows.net/{container_name}/{path}"
        
    return path


def _add_llm_candidates(text: str, entities: list[dict]) -> list[dict]:
    """
    Enrich deterministic regex/NER detections with LLM-suggested spans from the
    April PDF module, then re-run overlap merging so downstream anonymization
    receives one clean entity list.
    """
    try:
        from .utils import merge_results

        # Token-saving measure: Only run LLM enrichment for reasonably sized snippets.
        # Large documents (e.g. 50+ page PDFs) quickly exhaust Groq's daily free tier tokens.
        if len(text) > 15000:
            logger.info("Skipping LLM candidate enrichment for large document (%d chars) to conserve Groq tokens.", len(text))
            return entities

        llm_cands = llm_service.extract_pii_candidates(text)
        extra_entities = []
        for candidate in llm_cands:
            if isinstance(candidate, dict):
                value = str(candidate.get("value", "")).strip()
                entity_type = str(candidate.get("type", "UNKNOWN")).strip() or "UNKNOWN"
            else:
                value = str(candidate).strip()
                entity_type = "UNKNOWN"
            if len(value) <= 2:
                continue
            start_idx = 0
            while True:
                idx = text.find(value, start_idx)
                if idx == -1:
                    break
                extra_entities.append({
                    "entity": entity_type,
                    "value": value,
                    "start": idx,
                    "end": idx + len(value),
                    "score": candidate.get("confidence", 0.85) if isinstance(candidate, dict) else 0.85,
                    "source": "LLM",
                })
                start_idx = idx + len(value)
        return merge_results(entities, extra_entities)
    except Exception as e:
        logger.warning("LLM candidate enrichment skipped: %s", e)
        return entities


def _summarize_unstructured_entities(entities: list[dict]) -> list[dict]:
    type_counts: dict[str, int] = {}
    type_conf: dict[str, float] = {}
    for entity in entities:
        entity_type = entity.get("entity", "UNKNOWN")
        type_counts[entity_type] = type_counts.get(entity_type, 0) + 1
        type_conf[entity_type] = type_conf.get(entity_type, 0.0) + float(entity.get("score", 0.85))

    summary = []
    for entity_type, count in type_counts.items():
        avg_conf = type_conf[entity_type] / count
        status = "CRITICAL" if entity_type in {"PERSON", "PERSON_NAME", "EMAIL", "EMAIL_ADDRESS", "PHONE", "PHONE_NUMBER", "CREDIT_CARD", "SSN"} else "QUASI"
        default_tech = "anonymize" if "PERSON" in entity_type else ("mask" if status == "CRITICAL" else "suppress")
        summary.append({
            "type": entity_type,
            "label": entity_type.replace("_", " ").title(),
            "confidence": f"{round(avg_conf * 100, 1)}%",
            "status": status,
            "defaultTech": default_tech,
            "count": count,
        })
    return summary


def _build_text_pdf(text: str) -> bytes:
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    y = 54
    for line in text.split("\n"):
        if y > 780:
            page = doc.new_page()
            y = 54
        safe_line = line.encode("latin-1", "replace").decode("latin-1")
        page.insert_text((54, y), safe_line[:120], fontsize=10, fontname="helv")
        y += 15
    output = doc.write()
    doc.close()
    return output


def _resolve_catalog_structured_content(content: bytes) -> bytes:
    """
    Gov catalog and Blob catalog selections pass a lightweight marker File from
    the browser. Resolve that marker to the real server-side dataset bytes
    before pandas classification/anonymization.
    """
    try:
        marker = content.decode("utf-8", errors="ignore").strip()
    except Exception:
        return content

    if marker.startswith("__backend_filename__:"):
        filename = marker.split(":", 1)[1].strip()
        safe_path = (_CATALOG_UPLOAD_DIR / filename).resolve()
        root_path = _CATALOG_UPLOAD_DIR.resolve()
        if root_path not in safe_path.parents and safe_path != root_path:
            raise HTTPException(status_code=400, detail="Invalid catalog dataset path.")
        if not safe_path.exists():
            raise HTTPException(status_code=404, detail=f"Catalog dataset not found: {filename}")
        return safe_path.read_bytes()

    if marker.startswith("__blob_path__:"):
        blob_path = marker.split(":", 1)[1].strip()
        return blob_service.get_file(blob_path)

    return content


def _json_safe(value):
    """
    Convert pandas/numpy values from catalog datasets into strict JSON values.
    Starlette rejects NaN/Infinity even though pandas commonly emits them for
    blank CSV cells.
    """
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if hasattr(value, "item"):
        try:
            return _json_safe(value.item())
        except Exception:
            pass
    return value


def _resolve_sample_path(filename: str) -> Path:
    safe_path = (SAMPLE_DIR / filename).resolve()
    if SAMPLE_DIR not in safe_path.parents and safe_path != SAMPLE_DIR:
        raise HTTPException(status_code=400, detail="Invalid sample path.")
    if not safe_path.exists() or not safe_path.is_file():
        raise HTTPException(status_code=404, detail=f"Sample asset not found: {filename}")
    return safe_path


def _load_sample_manifest() -> dict:
    manifest_name = "anonymization_demo_manifest.json"
    local_manifest_path = _resolve_sample_path(manifest_name)
    local_payload = None

    if blob_service.client:
        try:
            with local_manifest_path.open("r", encoding="utf-8") as handle:
                local_payload = json.load(handle)
            _ensure_sample_assets_seeded(local_payload)
        except Exception as e:
            logger.warning("Local sample manifest pre-seed failed: %s", e)
        try:
            manifest_bytes = blob_service.get_sample_file(manifest_name)
            return json.loads(manifest_bytes.decode("utf-8"))
        except Exception:
            try:
                manifest_bytes = local_manifest_path.read_bytes()
                blob_service.upload_sample_file(manifest_bytes, manifest_name)
            except Exception as e:
                logger.warning("Sample manifest blob seed failed: %s", e)

    if local_payload is not None:
        return local_payload

    with local_manifest_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _ensure_sample_assets_seeded(payload: dict) -> None:
    if not blob_service.client:
        return

    sample_filenames = {"anonymization_demo_manifest.json"}
    for sample in payload.get("samples", []):
        for field in ("source_file", "result_file"):
            filename = sample.get(field)
            if filename:
                sample_filenames.add(str(filename))

    for filename in sample_filenames:
        try:
            blob_service.get_sample_file(filename)
        except Exception:
            try:
                local_path = _resolve_sample_path(filename)
                blob_service.upload_sample_file(local_path.read_bytes(), filename)
            except Exception as e:
                logger.warning("Sample asset blob seed failed for %s: %s", filename, e)


@router.get("/download")
async def download_anonymized_file(path: str = Query(...), filename: str = Query(...)):
    """
    Stream a stored anonymized file through the backend so private Blob containers
    can still be downloaded by the frontend without public blob access.
    """
    try:
        file_bytes = blob_service.get_file(path)
        media_type = "application/octet-stream"
        lower_name = filename.lower()
        if lower_name.endswith(".csv"):
            media_type = "text/csv"
        elif lower_name.endswith(".json"):
            media_type = "application/json"
        elif lower_name.endswith(".xlsx"):
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        elif lower_name.endswith(".pdf"):
            media_type = "application/pdf"
        elif lower_name.endswith(".docx"):
            media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        elif lower_name.endswith(".txt"):
            media_type = "text/plain"

        headers = {
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"
        }
        return StreamingResponse(io.BytesIO(file_bytes), media_type=media_type, headers=headers)
    except Exception as e:
        logger.error(f"Structured download failed for {path}: {e}")
        raise HTTPException(status_code=500, detail=f"Unable to download file: {str(e)}")


@router.get("/policy-metadata")
async def get_policy_metadata():
    """Returns coverage and regulatory info for all regional policies."""
    return POLICY_METADATA


@router.get("/samples/anonymization")
async def get_anonymization_samples():
    payload = _load_sample_manifest()

    samples = []
    for sample in payload.get("samples", []):
        entry = dict(sample)
        source_file = entry.get("source_file")
        result_file = entry.get("result_file")
        if source_file:
            entry["source_url"] = f"/team4/samples/anonymization/file/{quote(source_file)}"
            entry["source_blob_path"] = blob_service.sample_blob_name(source_file)
        if result_file:
            entry["result_url"] = f"/team4/samples/anonymization/file/{quote(result_file)}"
            entry["result_blob_path"] = blob_service.sample_blob_name(result_file)
        samples.append(entry)
    return {"samples": samples}


@router.get("/samples/anonymization/file/{filename:path}")
async def get_anonymization_sample_file(filename: str):
    try:
        if blob_service.client:
            file_bytes = blob_service.get_sample_file(filename)
            media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            headers = {
                "Content-Disposition": f"inline; filename*=UTF-8''{quote(filename)}"
            }
            return StreamingResponse(io.BytesIO(file_bytes), media_type=media_type, headers=headers)
    except Exception as e:
        logger.warning("Sample blob read failed for %s, falling back to local file: %s", filename, e)

    sample_path = _resolve_sample_path(filename)
    media_type = mimetypes.guess_type(sample_path.name)[0] or "application/octet-stream"
    return FileResponse(sample_path, media_type=media_type, filename=sample_path.name)


@router.post("/api/anonymization/pii-detection-structured")
async def pii_detection_structured(file: UploadFile = File(...), policy: str = Query("Global")):
    """
    Endpoint for structured data pii detection
    """
    logger.info("anonymization.classify.structured.start filename=%s", file.filename)
    if not file.filename.endswith(('.csv', '.json', '.xlsx')):
        raise HTTPException(status_code=400, detail="Unsupported file format for structured data.")
    
    try:
        content = await file.read()
        content = _resolve_catalog_structured_content(content)
        blob_name = blob_service.upload_input_file(content, file.filename)
        blob_data = blob_service.get_file(blob_name)

        # Load into DataFrame
        try:
            if file.filename.endswith('.csv'):
                df = pd.read_csv(io.BytesIO(content))
            elif file.filename.endswith('.json'):
                df = pd.read_json(io.BytesIO(content))
            else: # xlsx
                df = pd.read_excel(io.BytesIO(content))
        except Exception as e:
            logger.error(f"DataFrame Load Error: {e}")
            raise HTTPException(status_code=400, detail="Invalid data in file. Could not parse.")

        # Create Raw Preview (Top 5 rows as requested)
        raw_preview = df.head(5).to_dict(orient='records')
        
        # Performance slice for detection
        df_detect = df.head(20)

        # 1. LLM Analysis (Column-based)
        llm_result = llm_service.pii_detection(df.columns.to_list(), policy=policy)

        # 2. Local Analysis (Regex + Presidio)
        column_summary = {}
        for col in df_detect.columns:
            pii_counts = {}
            total_confidence = {}
            
            # Step A: Regex (Fast local patterns)
            for val in df_detect[col].dropna():
                regex_result = presidio.regex_detect(val, policy=policy)
                if regex_result:
                    pii_counts[regex_result] = pii_counts.get(regex_result, 0) + 1
                    total_confidence[regex_result] = total_confidence.get(regex_result, 0) + 1.0
            
            # Step B: Presidio (Deep analysis if regex didn't find specific hits)
            if not pii_counts:
                for val in df_detect[col].dropna():
                    p_results = presidio.analyze_text(val, policy=policy)
                    for res in p_results:
                        if res.score >= presidio.threshold:
                            pii_counts[res.entity_type] = pii_counts.get(res.entity_type, 0) + 1
                            total_confidence[res.entity_type] = total_confidence.get(res.entity_type, 0) + res.score

            column_summary[col] = []
            for entity, count in pii_counts.items():
                avg_conf = total_confidence[entity] / count
                column_summary[col].append({
                    "pii_type": entity,
                    "count": count,
                    "avg_confidence": round(avg_conf, 3)
                })
        # 3. Consolidate into the specific "gowri" format
        final_summary = {
            "Column Name": df.columns.to_list(),
            "Data Types": df.dtypes.astype(str).to_list(),
            "PII_Type_LLM": [],
            "PII_Type_NER": [],
            "Sensiivity": [], # Using the 'gowri' spelling for exact mapping
            "Risk": [],
            "Sample Value": []
        }

        for col in df.columns:
            # Map LLM findings
            l_info = llm_result.get(col, {"pii_type": "NONE", "sensitivity_level": "PUBLIC", "risk": "LOW"})
            pii_val = l_info.get("pii_type", "NONE")
            final_summary["PII_Type_LLM"].append(pii_val)
            final_summary["Sensiivity"].append(l_info.get("sensitivity_level", "PUBLIC"))
            final_summary["Risk"].append(l_info.get("risk", "LOW"))
            
            # Map NER (Presidio/Regex) findings
            ner_details = column_summary.get(col, [])
            final_summary["PII_Type_NER"].append(ner_details[0]["pii_type"] if ner_details else None)
            
            # Add Sample (First non-null row)
            sample_val = str(df[col].dropna().iloc[0]) if not df[col].dropna().empty else "—"
            final_summary["Sample Value"].append(sample_val)

        # AI Insights Banner Fallback Summary
        ai_summary = llm_service.summarize_pii_findings(final_summary["PII_Type_LLM"])
        logger.info(
            "anonymization.classify.structured.success filename=%s rows=%s cols=%s pii_columns=%s",
            file.filename,
            len(df),
            len(df.columns),
            len([pii for pii in final_summary["PII_Type_LLM"] if pii != "NONE"]),
        )

        return _json_safe({
            "status": "success",
            "result": final_summary,
            "raw_preview": raw_preview,
            "ai_summary": ai_summary,
            "num_rows": len(df),
            "num_cols": len(df.columns)
        })
    except Exception as e:
        import traceback
        logger.error(f"Structured classification failed: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/anonymization/pii-detection-unstructured")
async def pii_detection_unstructured(file: UploadFile = File(...), policy: str = Query("Global")):
    """
    Detection-only endpoint for unstructured data.
    """
    logger.info("anonymization.classify.unstructured.start filename=%s", file.filename)
    if not file.filename.endswith(('.pdf', '.docx', '.txt')):
        raise HTTPException(status_code=400, detail="Unsupported file format.")

    try:
        from .utils import extract_text, clean_text, regex_detect, presidio_detect, contextual_name_detect, merge_results
        content = await file.read()
        
        # Save temp for local libraries
        UPLOAD_DIR = "uploads"
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        temp_path = f"{UPLOAD_DIR}/temp_{file.filename}"
        with open(temp_path, "wb") as f:
            f.write(content)

        file_type = file.filename.split('.')[-1]
        text = extract_text(temp_path, file_type, raw_bytes=content, doc_intel_service=doc_intel_service)
        cleaned = clean_text(text)
        
        # PERFORMANCE: We scan the entire document now as requested
        preview_text = cleaned
        
        entities = merge_results(
            regex_detect(preview_text, policy=policy),
            presidio_detect(preview_text, policy=policy) + contextual_name_detect(preview_text),
        )
        entities = _add_llm_candidates(preview_text, entities)
        
        # Break into lines for the "gowri" table style
        lines = cleaned.split('\n')
        results_list = []
        current_offset = 0
        for i, line in enumerate(lines):
            line_entities = [e for e in entities if e['start'] >= current_offset and e['end'] <= (current_offset + len(line))]
            current_offset += len(line) + 1 # +1 for newline character
            for ent in line_entities:
                results_list.append({
                    "line_number": i + 1,
                    "line_text": line[:100] + "..." if len(line) > 100 else line,
                    "text_span": ent.get('value', '—'),
                    "llm_pii_type": ent['entity'],
                    "presidio_pii_type": ent.get('ner_type', 'NER'),
                    "status": "DETECTED"
                })

        # Calculate metrics and summary
        metrics = llm_service.calculate_privacy_metrics([e['entity'] for e in entities], len(cleaned))
        ai_summary = llm_service.summarize_pii_findings([e['entity'] for e in entities])
        logger.info(
            "anonymization.classify.unstructured.success filename=%s candidates=%s confirmed=%s",
            file.filename,
            len(entities),
            len([e for e in entities if e.get('confidence', 1) > 0.5]),
        )

        # Truncate result lists for frontend performance (avoids crashing UI with 10k+ rows)
        MAX_UI_RESULTS = 1000
        is_truncated = len(results_list) > MAX_UI_RESULTS
        
        return {
            "status": "success",
            "results": results_list[:MAX_UI_RESULTS],
            "entities": _summarize_unstructured_entities(entities),
            "raw_entities": entities[:MAX_UI_RESULTS * 2],
            "lines_processed": len(lines),
            "pii_candidates_found": len(entities),
            "pii_confirmed": len([e for e in entities if e.get('confidence', 1) > 0.5]),
            "ai_summary": ai_summary,
            "metrics": metrics,
            "preview": preview_text[:50000],
            "is_truncated": is_truncated,
            "max_preview_items": MAX_UI_RESULTS
        }
    except Exception as e:
        logger.error(f"Unstructured detection error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/anonymization/pii-detection-image")
async def pii_detection_image(file: UploadFile = File(...), policy: str = Query("Global")):
    """
    Detection-only endpoint for images.
    """
    logger.info("anonymization.classify.image.start filename=%s", file.filename)
    ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".webp"}
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported image format.")

    try:
        image_bytes = await file.read()
        entities = image_redactor.detect_entities(image_bytes, policy=policy)
        
        # Calculate metrics for images based on file size approximation
        approx_len = max(len(image_bytes) // 50, 1000)
        metrics = llm_service.calculate_privacy_metrics([e['entity_type'] for e in entities], approx_len)
        ai_summary = llm_service.summarize_pii_findings([e['entity_type'] for e in entities])
        logger.info(
            "anonymization.classify.image.success filename=%s entities=%s risk_score=%s",
            file.filename,
            len(entities),
            metrics.get("risk_score", 0),
        )

        return {
            "status": "success",
            "entities": entities,
            "ai_summary": ai_summary,
            "metrics": metrics
        }
    except Exception as e:
        logger.error(f"Image detection error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/anonymization/pii-detection-audio")
async def pii_detection_audio(file: UploadFile = File(...), policy: str = Query("Global")):
    """
    Detection-only endpoint for audio.
    """
    logger.info("anonymization.classify.audio.start filename=%s", file.filename)
    ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a"}
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported audio format. Please use .wav or .mp3.")

    try:
        audio_bytes = await file.read()
        res = audio_redactor.detect_pii(audio_bytes, file.filename, presidio, policy=policy)
        
        entities = res.get("entities", [])
        metrics = llm_service.calculate_privacy_metrics([e['entity_type'] for e in entities], max(res.get("duration", 1) * 10, 100))
        
        return {
            "status": "success",
            "transcript": res.get("transcript"),
            "entities": entities,
            "duration": res.get("duration"),
            "metrics": metrics,
            "ai_summary": res.get("ai_summary", "")
        }
    except Exception as e:
        logger.error(f"Audio detection error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/anonymize/structured")
async def anonymize_structured(file: UploadFile = File(...), config: str = Form(None), policy: str = Form("Global"), num_copies: int = Form(1)):
    """
    Endpoint for structured data (CSV/JSON).
    Performs PII detection, masking, and generates visualization stats.
    Supports generating multiple anonymized copies.
    """
    logger.info("anonymization.run.structured.start filename=%s", file.filename)
    if not file.filename.endswith(('.csv', '.json', '.xlsx')):
        raise HTTPException(status_code=400, detail="Unsupported file format for structured data.")

    try:
        content = await file.read()
        content = _resolve_catalog_structured_content(content)
        
        # Load into DataFrame
        if file.filename.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(content))
        elif file.filename.endswith('.json'):
            df = pd.read_json(io.BytesIO(content))
        else: # xlsx
            df = pd.read_excel(io.BytesIO(content))

        import json
        config_dict = None
        if config:
            try:
                config_dict = json.loads(config)
            except Exception as e:
                logger.error(f"Failed to parse config: {e}")

        # Process: Anonymize + Profile
        df_masked, stats = structured_engine.process_and_profile(df, config=config_dict)
        masked_preview = df_masked.head(10).fillna("").astype(str).to_dict(orient="records")

        # Convert masked DF back to CSV for upload
        output = io.StringIO()
        df_masked.to_csv(output, index=False)
        output_bytes = output.getvalue().encode('utf-8')

        # Upload to Azure Blob
        blob_filename = f"anonymized_{file.filename}"
        blob_path = blob_service.upload_file(output_bytes, blob_filename)
        logger.info(
            "anonymization.run.structured.success filename=%s output=%s masked_rows=%s",
            file.filename,
            blob_filename,
            len(masked_preview),
        )

        # Generate multiple anonymized copies if requested
        zip_base64 = None
        num_copies = max(1, min(int(num_copies or 1), 10))  # Clamp between 1 and 10
        
        if num_copies > 1:
            try:
                import zipfile
                zip_buffer = io.BytesIO()
                base_name = os.path.splitext(file.filename)[0]
                
                with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
                    # Copy 1 is the already-generated version
                    zf.writestr(f"{base_name}_copy_1.csv", output_bytes.decode('utf-8'))
                    
                    # Copies 2..N use fresh anonymization each time
                    for i in range(2, num_copies + 1):
                        df_variant, _ = structured_engine.process_and_profile(df, config=config_dict)
                        output_var = io.StringIO()
                        df_variant.to_csv(output_var, index=False)
                        zf.writestr(f"{base_name}_copy_{i}.csv", output_var.getvalue())
                
                zip_buffer.seek(0)
                zip_base64 = base64.b64encode(zip_buffer.getvalue()).decode("utf-8")
            except Exception as e:
                logger.warning("Failed to generate structured ZIP variants: %s", e)

        return {
            "status": "success",
            "blob_url": resolve_blob_url(blob_path),
            "blob_path": blob_path,
            "filename": blob_filename,
            "visual_stats": stats,
            "masked_preview": masked_preview,
            "zip_base64": zip_base64,
            "num_copies": num_copies,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/anonymize/unstructured")
async def anonymize_unstructured(
    request: Request,
    file: UploadFile = File(...),
    config: str = Form(None),
    policy: str = Form("Global"),
    mode: str = Form("suppress"),
    use_ai: bool = Form(False),
    num_copies: int = Form(1),
):
    """
    Endpoint for unstructured data (PDF/DOCX/TXT).
    Integrates the April PDF/document flow: LLM-enriched entity detection,
    configurable per-entity techniques, generated preview text, base64 output
    for browser download, and optional ZIP bundles for multiple variants.
    """
    logger.info("anonymization.run.unstructured.start filename=%s", file.filename)
    ALLOWED_EXTENSIONS = {'.pdf', '.docx', '.txt'}
    ext = os.path.splitext(file.filename.lower())[1]
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported format '{ext}'. Supported: {ALLOWED_EXTENSIONS}")

    try:
        from .utils import (
            extract_text, clean_text, regex_detect, presidio_detect, merge_results,
            contextual_name_detect, anonymize_text, anonymize_docx_file, anonymize_pdf_file,
        )

        query = request.query_params
        config = config or query.get("entity_config")
        policy = query.get("policy", policy)
        mode = query.get("mode", mode)
        use_ai = str(query.get("use_ai", use_ai)).lower() in {"true", "1", "yes"}
        num_copies = int(query.get("num_copies", num_copies) or 1)

        config_dict = {}
        if config:
            try:
                config_dict = json.loads(config)
            except Exception as e:
                logger.warning("Failed to parse unstructured config: %s", e)

        content = await file.read()

        UPLOAD_DIR = "uploads"
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        temp_file = f"{UPLOAD_DIR}/temp_{file.filename}"
        with open(temp_file, "wb") as f:
            f.write(content)

        file_type = ext.replace('.', '')
        raw_text = extract_text(temp_file, file_type, raw_bytes=content, doc_intel_service=doc_intel_service)
        cleaned_text = clean_text(raw_text)
        all_entities = merge_results(
            regex_detect(cleaned_text, policy=policy),
            presidio_detect(cleaned_text, policy=policy) + contextual_name_detect(cleaned_text),
        )
        all_entities = _add_llm_candidates(cleaned_text, all_entities)

        if use_ai or mode == "ai_contextual":
            anonymized_text = llm_service.contextual_anonymize(cleaned_text)
        else:
            anonymized_text = anonymize_text(cleaned_text, all_entities, mode=mode, mode_map=config_dict)

        media_type = "text/plain"
        if file_type == "pdf":
            try:
                output_bytes = anonymize_pdf_file(content, all_entities, mode_map=config_dict, policy=policy)
            except Exception as e:
                logger.warning("Native PDF redaction failed, using text PDF fallback: %s", e)
                output_bytes = _build_text_pdf(anonymized_text)
            media_type = "application/pdf"
        elif file_type == "docx":
            output_bytes = anonymize_docx_file(content, all_entities, mode_map=config_dict)
            media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        else:
            output_bytes = anonymized_text.encode("utf-8")

        output_filename = f"anonymized_{file.filename}"
        blob_path = blob_service.upload_file(output_bytes, output_filename)

        zip_base64 = None
        num_copies = max(1, min(int(num_copies or 1), 10))
        if num_copies > 1:
            try:
                import zipfile

                zip_buffer = io.BytesIO()
                base_name = os.path.splitext(file.filename)[0]
                output_ext = ext or ".txt"
                with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
                    for idx in range(1, num_copies + 1):
                        if idx == 1:
                            variant_text = anonymized_text
                            variant_bytes = output_bytes
                        else:
                            variant_text = anonymize_text(cleaned_text, all_entities, mode=mode, mode_map=config_dict)
                            if file_type == "pdf":
                                try:
                                    variant_bytes = anonymize_pdf_file(content, all_entities, mode_map=config_dict, policy=policy)
                                except Exception:
                                    variant_bytes = _build_text_pdf(variant_text)
                            elif file_type == "docx":
                                variant_bytes = anonymize_docx_file(content, all_entities, mode_map=config_dict)
                            else:
                                variant_bytes = variant_text.encode("utf-8")
                        zf.writestr(f"{base_name}_copy_{idx}{output_ext}", variant_bytes)
                        if output_ext != ".txt":
                            zf.writestr(f"{base_name}_copy_{idx}.txt", variant_text)
                zip_base64 = base64.b64encode(zip_buffer.getvalue()).decode("utf-8")
            except Exception as e:
                logger.warning("Failed to generate unstructured ZIP variants: %s", e)

        ai_summary = llm_service.summarize_pii_findings([e.get("entity", "UNKNOWN") for e in all_entities])
        logger.info(
            "anonymization.run.unstructured.success filename=%s output=%s entities=%s",
            file.filename,
            output_filename,
            len(all_entities),
        )

        return {
            "status": "success",
            "blob_url": resolve_blob_url(blob_path),
            "blob_path": blob_path,
            "filename": output_filename,
            "media_type": media_type,
            "output_base64": base64.b64encode(output_bytes).decode("utf-8"),
            "zip_base64": zip_base64,
            "num_copies": num_copies,
            "preview": anonymized_text[:1500],
            "full_text": anonymized_text,
            "entities": all_entities,
            "entity_summary": _summarize_unstructured_entities(all_entities),
            "ai_summary": ai_summary,
        }
    except Exception as e:
        logger.error(f"Unstructured anonymization error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/anonymize/image")
async def anonymize_image(file: UploadFile = File(...), config: str = Form(None), policy: str = Form("Global"), num_copies: int = Form(1)):
    """
    Anonymize PII embedded inside images with granular configuration.
    Supports generating multiple anonymized copies.
    """
    logger.info("anonymization.run.image.start filename=%s", file.filename)
    ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".webp"}
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported image format.")

    try:
        config_dict = {}
        if config:
            try:
                config_dict = json.loads(config)
            except Exception:
                pass

        image_bytes = await file.read()
        
        if config_dict:
            # Use granular redaction logic
            redacted_bytes, metadata = image_redactor.redact_with_config(image_bytes, file.filename, config_dict)
        else:
            # Use default redaction logic
            redacted_bytes, metadata = image_redactor.redact(image_bytes, file.filename)

        if metadata.get("error"):
            raise HTTPException(status_code=500, detail=metadata["error"])

        mime_map = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".bmp": "image/bmp", ".tiff": "image/tiff", ".webp": "image/webp"
        }
        media_type = mime_map.get(ext, "image/png")
        output_filename = f"redacted_{file.filename}"
        logger.info(
            "anonymization.run.image.success filename=%s output=%s entities=%s",
            file.filename,
            output_filename,
            metadata.get("entities_found"),
        )

        # Generate multiple anonymized copies if requested
        zip_base64 = None
        num_copies = max(1, min(int(num_copies or 1), 10))  # Clamp between 1 and 10
        
        if num_copies > 1:
            try:
                import zipfile
                zip_buffer = io.BytesIO()
                base_name = os.path.splitext(file.filename)[0]
                
                with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
                    # Copy 1 is the already-generated version
                    zf.writestr(f"{base_name}_copy_1{ext}", redacted_bytes)
                    
                    # Copies 2..N use fresh redaction each time
                    for i in range(2, num_copies + 1):
                        variant_bytes, _ = image_redactor.redact_with_config(image_bytes, file.filename, config_dict) if config_dict else image_redactor.redact(image_bytes, file.filename)
                        zf.writestr(f"{base_name}_copy_{i}{ext}", variant_bytes)
                
                zip_buffer.seek(0)
                zip_base64 = base64.b64encode(zip_buffer.getvalue()).decode("utf-8")
            except Exception as e:
                logger.warning("Failed to generate image ZIP variants: %s", e)

        return {
            "status": "success",
            "output_base64": base64.b64encode(redacted_bytes).decode("utf-8"),
            "media_type": media_type,
            "filename": output_filename,
            "zip_base64": zip_base64,
            "num_copies": num_copies,
            "metadata": metadata
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/anonymize/audio")
async def anonymize_audio(file: UploadFile = File(...), config: str = Form(None), detection_result: str = Form(None), policy: str = Form("Global"), num_copies: int = Form(1)):
    """
    Anonymize PII embedded inside audio with granular configuration.
    Supports generating multiple anonymized copies.
    """
    logger.info("anonymization.run.audio.start filename=%s", file.filename)
    ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a"}
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported audio format.")

    try:
        config_dict = {}
        if config:
            try:
                config_dict = json.loads(config)
            except Exception:
                pass
        
        det_res = {}
        if detection_result:
            try:
                det_res = json.loads(detection_result)
            except Exception:
                pass

        audio_bytes = await file.read()
        
        redacted_bytes = audio_redactor.redact_audio(audio_bytes, file.filename, config_dict, det_res)

        output_filename = f"redacted_{os.path.splitext(file.filename)[0]}.wav"
        
        # Generate multiple anonymized copies if requested
        zip_base64 = None
        num_copies = max(1, min(int(num_copies or 1), 10))  # Clamp between 1 and 10
        
        if num_copies > 1:
            try:
                import zipfile
                zip_buffer = io.BytesIO()
                base_name = os.path.splitext(file.filename)[0]
                
                with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
                    # Copy 1 is the already-generated version
                    zf.writestr(f"{base_name}_copy_1.wav", redacted_bytes)
                    
                    # Copies 2..N use fresh redaction each time
                    for i in range(2, num_copies + 1):
                        variant_bytes = audio_redactor.redact_audio(audio_bytes, file.filename, config_dict, det_res)
                        zf.writestr(f"{base_name}_copy_{i}.wav", variant_bytes)
                
                zip_buffer.seek(0)
                zip_base64 = base64.b64encode(zip_buffer.getvalue()).decode("utf-8")
            except Exception as e:
                logger.warning("Failed to generate audio ZIP variants: %s", e)
        
        return {
            "status": "success",
            "output_base64": base64.b64encode(redacted_bytes).decode("utf-8"),
            "media_type": "audio/wav",
            "filename": output_filename,
            "zip_base64": zip_base64,
            "num_copies": num_copies
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==============================================================
# CATALOG ENDPOINTS  —  data.gov.in + Azure Blob listing
# Requires:  pip install httpx
# ==============================================================

import asyncio
import csv as _csv
import uuid as _uuid
from pathlib import Path as _Path
from pydantic import BaseModel

try:
    import httpx as _httpx
    _HTTPX_AVAILABLE = True
except ImportError:
    _HTTPX_AVAILABLE = False

_DATA_GOV_API_KEY = os.environ.get("DATA_GOV_API_KEY", "")
_CATALOG_UPLOAD_DIR = _Path("./uploads")
_CATALOG_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

_ANALYSIS_MAX_ROWS = 100_000
_FETCH_PAGE_SIZE   = 2_000
_MAX_DOWNLOAD_ROWS = 100_000


# ── 1. GET /team4/datasets — catalog listing ─────────────────
@router.get("/datasets")
async def list_datasets(q: str = "", offset: int = 0, limit: int = 30, sector: str = ""):
    """Proxy to data.gov.in catalog API."""
    if not _HTTPX_AVAILABLE:
        return {"total": 0, "results": [], "error": "httpx not installed — run: pip install httpx"}
    if not _DATA_GOV_API_KEY:
        return {"total": 0, "results": [], "error": "DATA_GOV_API_KEY not set in .env"}

    params: dict = {
        "format": "json",
        "api-key": _DATA_GOV_API_KEY,
        "offset": offset,
        "limit": limit,
        "filters[org_type]": "Central",
    }
    if q.strip():
        params["filters[title]"] = q.strip()
    if sector.strip() and sector.strip().lower() not in ("all sectors", ""):
        params["filters[sector]"] = sector.strip()

    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            resp = await client.get("https://api.data.gov.in/lists", params=params)
            resp.raise_for_status()
            data = resp.json()

        results = []
        for item in data.get("records", []):
            try:
                sector_list = item.get("sector") or []
                org_list    = item.get("org") or []
                category = sector_list[0] if isinstance(sector_list, list) and sector_list else "General"
                org_name = org_list[0]    if isinstance(org_list, list) and org_list    else "Government of India"
                title = str(item.get("title") or "Untitled").strip()
                if not title or title.lower().startswith("mydata-"):
                    continue
                index_name = str(item.get("index_name") or item.get("id") or "")
                raw_fields = item.get("field") or []
                fields = [
                    {"name": str(f.get("name", "?")), "type": str(f.get("type", "unknown"))}
                    for f in raw_fields if isinstance(f, dict)
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

        total = int(data.get("total", len(results)))
        return {"total": total, "results": results}

    except Exception as exc:
        logger.warning("data.gov.in list error: %s", exc)
        return {"total": 0, "results": [], "error": str(exc)}


# ── 2. GET /team4/datasets/sample/{index_id} ─────────────────
@router.get("/datasets/sample/{index_id:path}")
async def get_dataset_sample(index_id: str, limit: int = 500):
    """Fetch sample rows for in-browser preview."""
    if not _HTTPX_AVAILABLE:
        return {"records": [], "field": [], "total": 0, "error": "httpx not installed"}
    if not _DATA_GOV_API_KEY:
        return {"records": [], "field": [], "total": 0, "error": "DATA_GOV_API_KEY not set"}

    url = f"https://api.data.gov.in/resource/{index_id}"
    params = {"api-key": _DATA_GOV_API_KEY, "format": "json", "limit": limit, "offset": 0}
    try:
        async with _httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        return {"records": data.get("records", []), "field": data.get("field", []), "total": int(data.get("total", 0))}
    except _httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        msg = "Resource not found" if code == 404 else f"HTTP {code}"
        return {"records": [], "field": [], "total": 0, "error": msg}
    except Exception as exc:
        return {"records": [], "field": [], "total": 0, "error": str(exc)}


# ── 3. POST /team4/datasets/fetch-for-analysis ───────────────
class _FetchRequest(BaseModel):
    index_id:     str
    dataset_name: str
    max_rows:     int = _ANALYSIS_MAX_ROWS


@router.post("/datasets/fetch-for-analysis")
async def fetch_dataset_for_analysis(payload: _FetchRequest):
    """Downloads a dataset server-to-server and writes it to uploads/. Streams NDJSON progress."""
    if not _HTTPX_AVAILABLE:
        async def _err():
            yield json.dumps({"type": "error", "message": "httpx not installed"}) + "\n"
        return StreamingResponse(_err(), media_type="application/x-ndjson")
    if not _DATA_GOV_API_KEY:
        async def _err2():
            yield json.dumps({"type": "error", "message": "DATA_GOV_API_KEY not set in .env"}) + "\n"
        return StreamingResponse(_err2(), media_type="application/x-ndjson")

    max_rows  = min(payload.max_rows, _ANALYSIS_MAX_ROWS)
    safe_base = re.sub(r"[^\w\-]", "_", payload.dataset_name)[:50]
    filename  = f"{safe_base}_{_uuid.uuid4().hex[:8]}.csv"
    file_path = _CATALOG_UPLOAD_DIR / filename
    base_url  = f"https://api.data.gov.in/resource/{payload.index_id}"

    async def _stream():
        rows_written = 0
        total_available = None
        header_written  = False
        page_errors     = 0
        MAX_PAGE_ERRORS = 3

        try:
            with open(file_path, "w", newline="", encoding="utf-8") as fh:
                writer = None
                async with _httpx.AsyncClient(
                    timeout=_httpx.Timeout(connect=10, read=20, write=10, pool=5)
                ) as client:
                    offset = 0
                    while rows_written < max_rows:
                        page_limit = min(_FETCH_PAGE_SIZE, max_rows - rows_written)
                        params = {"api-key": _DATA_GOV_API_KEY, "format": "json", "limit": page_limit, "offset": offset}
                        try:
                            resp = await client.get(base_url, params=params)
                            resp.raise_for_status()
                            data = resp.json()
                            page_errors = 0
                        except (_httpx.TimeoutException, _httpx.HTTPStatusError) as exc:
                            page_errors += 1
                            if page_errors >= MAX_PAGE_ERRORS:
                                if rows_written == 0:
                                    file_path.unlink(missing_ok=True)
                                    yield json.dumps({"type": "error", "message": str(exc)}) + "\n"
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
                            except Exception:
                                total_available = None
                        if not header_written:
                            fieldnames = list(records[0].keys())
                            writer = _csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore", lineterminator="\n")
                            writer.writeheader()
                            header_written = True
                        for record in records:
                            writer.writerow(record)  # type: ignore[union-attr]
                            rows_written += 1
                        offset += len(records)
                        pct = int((rows_written / min(max_rows, total_available or max_rows)) * 100) if total_available else 0
                        yield json.dumps({"type": "progress", "rows_fetched": rows_written, "total": total_available, "pct": min(pct, 99)}) + "\n"
                        if total_available and offset >= total_available:
                            break
        except Exception as exc:
            file_path.unlink(missing_ok=True)
            yield json.dumps({"type": "error", "message": str(exc)}) + "\n"
            return

        if rows_written == 0:
            file_path.unlink(missing_ok=True)
            yield json.dumps({"type": "error", "message": "data.gov.in returned no records for this resource."}) + "\n"
            return

        truncated = total_available is not None and rows_written < total_available
        yield json.dumps({"type": "complete", "filename": filename, "rows_fetched": rows_written, "total_available": total_available, "truncated": truncated}) + "\n"

    return StreamingResponse(_stream(), media_type="application/x-ndjson")


# ── 4. GET /team4/datasets/download/{index_id} ───────────────
@router.get("/datasets/download/{index_id:path}")
async def download_dataset_csv(index_id: str, filename: str = "dataset"):
    """Streams the full dataset from data.gov.in as CSV. API key stays server-side."""
    if not _HTTPX_AVAILABLE:
        raise HTTPException(status_code=503, detail="httpx not installed")
    if not _DATA_GOV_API_KEY:
        raise HTTPException(status_code=503, detail="DATA_GOV_API_KEY not set")

    base_url  = f"https://api.data.gov.in/resource/{index_id}"
    PAGE_SIZE = 1_000

    async def csv_stream():
        buf = io.StringIO()
        csv_writer = None
        rows_written = 0
        offset = 0
        first_page = True
        async with _httpx.AsyncClient(timeout=30) as client:
            while rows_written < _MAX_DOWNLOAD_ROWS:
                params = {"api-key": _DATA_GOV_API_KEY, "format": "json", "limit": min(PAGE_SIZE, _MAX_DOWNLOAD_ROWS - rows_written), "offset": offset}
                try:
                    resp = await client.get(base_url, params=params)
                    resp.raise_for_status()
                    data = resp.json()
                except Exception as exc:
                    logger.error("CSV download page error: %s", exc)
                    break
                records = data.get("records", [])
                if not records:
                    break
                for record in records:
                    if csv_writer is None:
                        headers = list(record.keys())
                        csv_writer = _csv.DictWriter(buf, fieldnames=headers, extrasaction="ignore", lineterminator="\n")
                        if first_page:
                            csv_writer.writeheader()
                            first_page = False
                    csv_writer.writerow(record)
                    rows_written += 1
                chunk = buf.getvalue()
                buf.truncate(0)
                buf.seek(0)
                if chunk:
                    yield chunk.encode("utf-8")
                total = int(data.get("total", 0))
                offset += len(records)
                if offset >= total:
                    break
        if rows_written >= _MAX_DOWNLOAD_ROWS:
            yield f"\n# Capped at {_MAX_DOWNLOAD_ROWS:,} rows.\n".encode("utf-8")

    safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in filename)[:60].strip() or "dataset"
    return StreamingResponse(
        csv_stream(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.csv"', "X-Accel-Buffering": "no"},
    )


# ── 5. GET /team4/blob-files — list files in Azure Blob ──────
@router.get("/blob-files")
async def list_blob_files():
    """
    Lists CSV/JSON/XLSX files already present in Azure Blob Storage.
    Returns [{name, blob_path, size_kb, last_modified}].
    """
    SUPPORTED_EXTS = {".csv", ".json", ".xlsx", ".pdf", ".txt", ".docx"}
    try:
        container_client = blob_service.client
        files = []
        
        # 1. Try to list from Azure if client exists
        if container_client:
            try:
                for blob in container_client.list_blobs():
                    ext = _Path(blob.name).suffix.lower()
                    if ext in SUPPORTED_EXTS:
                        size_kb = round((blob.size or 0) / 1024, 1)
                        files.append({
                            "name": _Path(blob.name).name,
                            "blob_path": blob.name,
                            "size_kb": size_kb,
                            "last_modified": blob.last_modified.isoformat() if blob.last_modified else None,
                        })
            except Exception as azure_exc:
                logger.warning(f"Azure listing failed (possibly Auth error): {azure_exc}. Using local fallback.")

        # 2. Always (or as fallback) list from Local Directory
        local_dir = "uploads/anonymization"
        existing_local_names = {f["name"] for f in files}
        if os.path.exists(local_dir):
            for filename in os.listdir(local_dir):
                if filename in existing_local_names:
                    continue
                f_path = os.path.join(local_dir, filename)
                if os.path.isfile(f_path):
                    ext = _Path(filename).suffix.lower()
                    if ext in SUPPORTED_EXTS:
                        stats = os.stat(f_path)
                        from datetime import datetime
                        files.append({
                            "name": filename,
                            "blob_path": f"local_file:{filename}",
                            "size_kb": round(stats.st_size / 1024, 1),
                            "last_modified": datetime.fromtimestamp(stats.st_mtime).isoformat(),
                        })
        
        return {"files": sorted(files, key=lambda f: f["last_modified"] or "", reverse=True)}
        return {"files": sorted(files, key=lambda f: f["last_modified"] or "", reverse=True)}


    except Exception as exc:
        logger.warning("blob-files listing error: %s", exc)
        return {"files": [], "error": str(exc)}
