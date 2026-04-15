"""
router.py  –  MANDATORY router for Team 5 (Multimodal).
Contains only API endpoints; business logic lives in services.py.

Updated: Added 2 new endpoints for Image Q&A and Advanced Search.
"""

import logging
import os

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
import httpx
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
import json
import asyncio

from modules.team5_multimodal.config import get_settings
from modules.team5_multimodal.models import (
    TextAnalysisResponse, CodeAnalysisResponse, MultiImageAnalysisResponse, ImageAnalysisResponse
)
from modules.team5_multimodal.services import TextAnalysisService
from modules.team5_multimodal.code_analysis_service import CodeAnalysisService
from modules.team5_multimodal.image_analysis_service import ImageAnalysisService as TeammateImageAnalysisService
from modules.team5_multimodal.image_services import ImageAnalysisService as ZipImageAnalysisService
from modules.team5_multimodal.audio_analysis_service import AudioAnalysisService
from modules.team5_multimodal.audio_feature_extractor import AudioFeatureExtractor
from modules.team5_multimodal.models import (
    AudioAnalysisResponse,
    AudioFeaturesResponse,
    AudioFeatures,
    WaveformData,
    SpectrogramData,
    EnergyData,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/team5", tags=["Team 5 - Multimodal"])

PDF_CONTENT_TYPES = {
    "application/pdf",
    "application/x-pdf",
}


@router.post("/analyze", response_model=TextAnalysisResponse)
async def analyze_text(file: UploadFile = File(...)):
    """Accept a .txt or .pdf file and return structured analysis."""
    raw_bytes = await file.read()

    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    service = TextAnalysisService()

    if file.content_type in PDF_CONTENT_TYPES or (
        file.filename and file.filename.lower().endswith(".pdf")
    ):
        text = service.extract_pdf_text(raw_bytes)
        if not text.strip():
            raise HTTPException(
                status_code=422,
                detail="Could not extract text from the PDF.",
            )
    else:
        text = raw_bytes.decode("utf-8", errors="replace")

    try:
        result = await service.analyze(text)
    except Exception as exc:
        logger.exception("Analysis failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return TextAnalysisResponse(
        filename=file.filename or "unknown",
        content_type=file.content_type or "application/octet-stream",
        result=result,
    )


class GithubAnalysisRequest(BaseModel):
    repo_url: str


@router.post("/code-analyze")
async def analyze_code(file: UploadFile = File(...)):
    """Accept a ZIP file of a codebase and perform 2-pass LLM analysis via stream."""
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only ZIP files are supported.")

    zip_bytes = await file.read()
    service = CodeAnalysisService()

    async def event_generator():
        try:
            yield json.dumps({"type": "progress", "step": "extracting", "message": "Extracting ZIP archive..."}) + "\n"
            root_dir = service.extract_zip(zip_bytes)
            
            async for update in service.analyze_repo_stream(root_dir, file.filename):
                yield json.dumps(update) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")

@router.post("/code-analyze/github")
async def analyze_code_github(payload: GithubAnalysisRequest):
    """Clone a GitHub repository and perform 2-pass LLM analysis via stream."""
    service = CodeAnalysisService()

    async def event_generator():
        try:
            yield json.dumps({"type": "progress", "step": "cloning", "message": f"Cloning {payload.repo_url}..."}) + "\n"
            root_dir = service.clone_github_repo(payload.repo_url)
            
            repo_name = payload.repo_url.rstrip('/').split('/')[-1]
            async for update in service.analyze_repo_stream(root_dir, repo_name):
                yield json.dumps(update) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


@router.post("/analyze-images", response_model=MultiImageAnalysisResponse)
async def analyze_images_teammate(files: list[UploadFile] = File(...)):
    """Accept multiple images. Now with smart cluster naming via Groq."""
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    service = TeammateImageAnalysisService()
    results = []
    embeddings = []
    filenames = []

    try:
        for file in files:
            if not file.content_type.startswith("image/"):
                logger.warning("Skipping non-image file: %s", file.filename)
                continue

            raw_bytes = await file.read()
            if not raw_bytes:
                continue

            res, embed = service.analyze_image(raw_bytes, file.filename or "unknown")
            results.append(res)
            embeddings.append(embed)
            filenames.append(file.filename or "unknown")

        # Pass results for smart cluster naming (Point 1)
        projection, clusters = service.perform_clustering(embeddings, filenames, results=results)

        return MultiImageAnalysisResponse(
            results=results,
            projection=projection,
            clusters=clusters
        )

    except Exception as exc:
        logger.exception("Image analysis failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/image-analyze-batch", response_model=ImageAnalysisResponse)
async def analyze_images_batch(files: list[UploadFile] = File(...)):
    """Accepts a ZIP file OR a list of individual image files and processes them."""
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    service = ZipImageAnalysisService()
    
    try:
        # Case A: A single ZIP file
        if len(files) == 1 and files[0].filename.lower().endswith(".zip"):
            zip_bytes = await files[0].read()
            extract_dir = service.extract_zip(zip_bytes)
            analysis_result = service.process_images(extract_dir)
            display_name = files[0].filename
        
        # Case B: Multiple individual image files
        else:
            # Filter for images
            img_files = [f for f in files if f.content_type and f.content_type.startswith("image/")]
            if not img_files:
                raise HTTPException(status_code=400, detail="No valid images or ZIP archive found.")
            
            extract_dir = service.save_files(img_files)
            analysis_result = service.process_images(extract_dir)
            display_name = f"Batch of {len(img_files)} images"

        return ImageAnalysisResponse(
            filename=display_name,
            processed_count=len(analysis_result.clusters),
            result=analysis_result
        )

    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))
    except Exception as exc:
        logger.exception("Image batch analysis pipeline failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ──────────────────────────────────────────────
#  NEW ENDPOINTS (Groq-powered)
# ──────────────────────────────────────────────

class ImageAskExistingRequest(BaseModel):
    image_path: str
    question: str


@router.post("/image-ask-existing")
async def ask_about_existing_image(payload: ImageAskExistingRequest):
    """
    New Enhancement: Ask about an image that was already processed from a ZIP.
    Expects a local file path relative to the capstone_2 root.
    """
    if not payload.image_path or not payload.question.strip():
        raise HTTPException(status_code=400, detail="Missing image path or question.")

    # Convert relative path to absolute to prevent directory traversal or path issues
    base_dir = os.getcwd()
    abs_path = os.path.join(base_dir, payload.image_path)
    
    # Security check: Ensure the path is inside the shared_workspace
    if "shared_workspace" not in abs_path:
         raise HTTPException(status_code=403, detail="Access denied to requested path.")

    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail=f"Image not found at: {payload.image_path}")

    try:
        with open(abs_path, "rb") as f:
            image_bytes = f.read()
        
        service = TeammateImageAnalysisService()
        answer = service.ask_about_image(image_bytes, payload.question.strip())
        
        return {
            "status": "success",
            "image_path": payload.image_path,
            "question": payload.question.strip(),
            "answer": answer
        }
    except Exception as exc:
        logger.exception("Existing Image Q&A failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/image-ask")
async def ask_about_image(
    file: UploadFile = File(...),
    question: str = Form(...)
):
    """
    Point 2 - Contextual Image Q&A:
    Upload an image + ask any question. Groq Vision answers intelligently.
    """
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are accepted.")

    if not question or not question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded image is empty.")

    service = TeammateImageAnalysisService()

    try:
        answer = service.ask_about_image(image_bytes, question.strip())
        return {
            "status": "success",
            "filename": file.filename,
            "question": question.strip(),
            "answer": answer
        }
    except Exception as exc:
        logger.exception("Image Q&A failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class ImageSearchRequest(BaseModel):
    query: str
    captions: list[dict]


@router.post("/image-search")
async def search_images(payload: ImageSearchRequest):
    """
    Point 3 - Advanced Search Intelligence:
    Search images using complex natural language queries powered by Groq.
    """
    if not payload.query or not payload.query.strip():
        raise HTTPException(status_code=400, detail="Search query cannot be empty.")

    if not payload.captions:
        raise HTTPException(status_code=400, detail="No image captions provided.")

    service = TeammateImageAnalysisService()

    try:
        ranked_results = service.search_images(payload.query.strip(), payload.captions)
        return {
            "status": "success",
            "query": payload.query.strip(),
            "total_searched": len(payload.captions),
            "results": ranked_results
        }
    except Exception as exc:
        logger.exception("Image search failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ──────────────────────────────────────────────
#  Multimodal Audio Pipeline (Diarization + Sync Text Analysis)
# ──────────────────────────────────────────────
@router.post("/analyze-audio", response_model=AudioAnalysisResponse)
async def analyze_audio(file: UploadFile = File(...)):
    """
    Accepts an audio file (.mp3, .wav, etc).
    - Checks 50MB size limit and 5m length limit.
    - Transcribes with Whisper.
    - Diarizes with Pyannote (requires HF token).
    - Runs text analysis on the transcribed text.
    """
    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    service = AudioAnalysisService()

    try:
        # Process audio (sync, computationally heavy, could be offloaded to process pool if needed)
        # Using run_in_executor to avoid blocking the event loop
        loop = asyncio.get_running_loop()
        analysis_result = await loop.run_in_executor(None, service.process_audio, raw_bytes, file.filename or "audio.wav")

        # Run text analysis asynchronously
        text_analysis = await service.analyze_transcript(analysis_result.transcript_text)
        analysis_result.text_analysis = text_analysis

        return AudioAnalysisResponse(
            filename=file.filename or "unknown",
            content_type=file.content_type or "audio/wav",
            result=analysis_result
        )
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))
    except Exception as exc:
        logger.exception("Audio analysis failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ──────────────────────────────────────────────
#  TASK 1 + 2: Lightweight Audio Features Endpoint
#  No Whisper, no diarization, no HF token required.
#  Extracts waveform, spectrogram, RMS energy from any audio file.
#  Great for demos and machines where heavy deps may not be installed.
# ──────────────────────────────────────────────
@router.post("/audio-features", response_model=AudioFeaturesResponse)
async def extract_audio_features(file: UploadFile = File(...)):
    """
    Lightweight acoustic feature extraction endpoint.
    Accepts any audio file (.wav, .mp3, .m4a, .ogg, .flac).
    Returns: waveform, STFT spectrogram (128x100 downsampled), RMS energy timeline.
    No Whisper/diarization executed — suitable for visualization demos.
    """
    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    from modules.team5_multimodal.config import get_settings
    settings = get_settings()
    extractor = AudioFeatureExtractor(
        ffmpeg_exe=settings.ffmpeg_path or "",
        ffprobe_exe=settings.ffprobe_path or "",
    )

    try:
        loop = asyncio.get_running_loop()
        raw_features = await loop.run_in_executor(
            None,
            lambda: extractor.extract(
                raw_bytes,
                file.filename or "audio.wav",
                include_mfcc=False,
            ),
        )
        pydantic_features = AudioFeatures.model_validate(raw_features, from_attributes=True)

        return AudioFeaturesResponse(
            filename=file.filename or "unknown",
            content_type=file.content_type or "audio/wav",
            result=pydantic_features,
        )
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))
    except Exception as exc:
        logger.exception("Audio feature extraction failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ──────────────────────────────────────────────
#  Video Analysis Pipeline (YOLO + BLIP + CLIP + Whisper)
# ──────────────────────────────────────────────

_VIDEO_TMP_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "shared_workspace", "1_raw_uploads")

@router.post("/video-analyze")
async def analyze_video_endpoint(file: UploadFile = File(...)):
    """
    Accept a video file and run full multimodal analysis:
    YOLO object detection + BLIP captioning + CLIP embeddings + Groq summary.
    Returns JSON with detected objects, frame captions, and summary.
    """
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="Only video files are supported.")

    import tempfile as _tmp
    from modules.team5_multimodal.Video_analysis import analyze_video

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    suffix = os.path.splitext(file.filename or "upload.mp4")[1] or ".mp4"

    try:
        with _tmp.NamedTemporaryFile(suffix=suffix, delete=False) as inp:
            inp.write(raw_bytes)
            input_path = inp.name

        with _tmp.NamedTemporaryFile(suffix=".mp4", delete=False) as out:
            output_path = out.name

        model_path = "yolov8n.pt"
        result = await asyncio.to_thread(analyze_video, input_path, output_path, model_path, False)

        if result is None:
            raise HTTPException(status_code=500, detail="Video analysis failed.")

        result.pop("output_video", None)
        result["video_url"] = f"/team5/stream-temp-video?path={os.path.basename(output_path)}"
        result["_output_path"] = output_path  # internal — stripped before returning
        out_path = result.pop("_output_path")

        # Store output path for streaming endpoint
        import builtins
        builtins._last_analyzed_video = out_path  # type: ignore[attr-defined]

        return result

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Video analysis failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        try:
            os.unlink(input_path)
        except Exception:
            pass


@router.get("/stream-temp-video")
async def stream_temp_video():
    """Stream the most recently analyzed video file."""
    import builtins
    video_path = getattr(builtins, "_last_analyzed_video", None)
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="No analyzed video available. Run /video-analyze first.")
    return FileResponse(
        video_path,
        media_type="video/mp4",
        headers={"Accept-Ranges": "bytes", "Cache-Control": "no-cache", "Content-Disposition": "inline"},
    )


# ──────────────────────────────────────────────
#  data.gov.in Catalog Proxy
# ──────────────────────────────────────────────
@router.get("/datasets")
async def list_datasets(q: str = "", sector: str = "", offset: int = 0, limit: int = 20):
    """
    Proxy to data.gov.in catalog API.
    Returns { total, results: [{name, desc, category, org}] }
    """
    settings = get_settings()
    api_key = settings.data_gov_api_key
    if not api_key:
        return {"total": 0, "results": [], "error": "DATA_GOV_API_KEY not configured"}

    params: dict = {
        "format": "json",
        "api-key": api_key,
        "offset": offset,
        "limit": limit,
        "filters[org_type]": "Central",
    }
    
    # Add sector filter if provided
    if sector.strip():
        params["filters[sector]"] = sector.strip()

    if q.strip():
        # Searching by dataset keywords/tags is more comprehensive than title alone
        params["filters[title]"] = q.strip()
        # Note: We can expand this to filters[desc] or other fields if the API allows multi-filter AND queries

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
                results.append({
                    "name": title,
                    "desc": str(item.get("desc") or ""),
                    "category": str(category),
                    "org": str(org_name),
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


# ──────────────────────────────────────────────
#  Code Chat — Q&A about a codebase analysis result
# ──────────────────────────────────────────────
class CodeChatRequest(BaseModel):
    question: str
    context: str          # plain-text summary of the analysis (~2-3 KB)
    history: list[dict] = []   # [{role, content}] last N turns

@router.post("/code-chat")
async def chat_about_codebase(payload: CodeChatRequest):
    """Answer a question about the codebase using the analysis result as context."""
    from openai import AsyncOpenAI
    settings = get_settings()
    if settings.nvidia_api_key:
        client = AsyncOpenAI(base_url="https://integrate.api.nvidia.com/v1", api_key=settings.nvidia_api_key)
        model_name = settings.nvidia_model
    else:
        client = AsyncOpenAI(base_url="https://api.groq.com/openai/v1", api_key=settings.groq_api_key)
        model_name = settings.groq_model

    system = (
        "You are an expert software architect. Answer questions about the codebase described below. "
        "Be concise, reference actual component names and file paths from the context.\n\n"
        f"=== CODEBASE CONTEXT ===\n{payload.context[:4000]}\n=== END ==="
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
        logger.error("code-chat LLM error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ──────────────────────────────────────────────
#  Audio Chat — Q&A about a transcript
# ──────────────────────────────────────────────
class AudioChatRequest(BaseModel):
    transcript_text: str
    question: str
    history: list[dict] = []  # [{role, content}] — last N turns

@router.post("/audio-chat")
async def chat_about_audio(payload: AudioChatRequest):
    """Answer a question about an audio transcript using the transcript as context."""
    from openai import AsyncOpenAI
    settings = get_settings()
    if settings.nvidia_api_key:
        client = AsyncOpenAI(base_url="https://integrate.api.nvidia.com/v1", api_key=settings.nvidia_api_key)
        model_name = settings.nvidia_model
    else:
        client = AsyncOpenAI(base_url="https://api.groq.com/openai/v1", api_key=settings.groq_api_key)
        model_name = settings.groq_model

    # Truncate long transcripts to avoid token limits
    transcript_excerpt = payload.transcript_text[:4000] if payload.transcript_text else "(no transcript)"
    system = (
        "You are an expert audio analyst. Answer questions about the audio recording based on its transcript. "
        "Be concise and insightful. Reference specific quotes or speakers when relevant.\n\n"
        f"=== TRANSCRIPT ===\n{transcript_excerpt}\n=== END ==="
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
        logger.error("audio-chat LLM error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/demo-video-stream")
async def get_demo_video():
    """Stream the pre-analyzed demo video (huhu_analyzed.mp4) with range-request headers."""
    video_path = os.path.join(os.path.dirname(__file__), "huhu_analyzed.mp4")
    if not os.path.exists(video_path):
        raise HTTPException(
            status_code=404,
            detail="Demo video not found. Place huhu_analyzed.mp4 in modules/team5_multimodal/."
        )
    return FileResponse(
        video_path,
        media_type="video/mp4",
        headers={
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache",
            "Content-Disposition": "inline",
        },
    )


@router.get("/demo-video-metadata")
async def get_demo_video_metadata():
    """Return pre-computed analysis metadata for the demo video (if available)."""
    meta_path = os.path.join(os.path.dirname(__file__), "huhu_analyzed_metadata.json")
    if not os.path.exists(meta_path):
        return {
            "groq_summary": "Demo metadata not available.",
            "detected_objects": {},
            "frame_captions": [],
            "clip_scenes": [],
            "keyframes_analyzed": 0,
            "duration_seconds": 0,
        }
    with open(meta_path, "r") as f:
        return json.load(f)
