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
    AudioVerdict,
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
            # Filter for images (including HEIC/HEIF even if MIME type is missing/generic)
            img_files = []
            for f in files:
                ext = f.filename.lower()
                is_img = (f.content_type and f.content_type.startswith("image/"))
                is_heif = ext.endswith(".heic") or ext.endswith(".heif")
                if is_img or is_heif:
                    img_files.append(f)

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
    images: list[dict]


class ImageCollectionAskRequest(BaseModel):
    question: str
    images: list[dict]


@router.post("/image-collection-ask")
async def ask_about_image_collection(payload: ImageCollectionAskRequest):
    """
    Collection-level Q&A:
    Answer questions about an analyzed batch using captions, objects, and cluster labels.
    """
    if not payload.question or not payload.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    if not payload.images:
        raise HTTPException(status_code=400, detail="No analyzed images provided.")

    service = TeammateImageAnalysisService()

    try:
        result = service.ask_about_collection(payload.question.strip(), payload.images)
        return {
            "status": "success",
            "question": payload.question.strip(),
            **result,
        }
    except Exception as exc:
        logger.exception("Collection image Q&A failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/image-search")
async def search_images(payload: ImageSearchRequest):
    """
    Point 3 - Advanced Search Intelligence:
    Search images using complex natural language queries powered by Groq.
    """
    if not payload.query or not payload.query.strip():
        raise HTTPException(status_code=400, detail="Search query cannot be empty.")

    if not payload.images:
        raise HTTPException(status_code=400, detail="No analyzed images provided.")

    service = TeammateImageAnalysisService()

    try:
        ranked_results = service.search_images(payload.query.strip(), payload.images)
        return {
            "status": "success",
            "query": payload.query.strip(),
            "total_searched": len(payload.images),
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

        # Best-effort verdict generation (never blocks core analyze-audio response)
        try:
            interp = analysis_result.interpretation
            quality = analysis_result.audio_quality
            verdict_payload = AudioVerdictRequest(
                snr=quality.snr_db if quality else None,
                noise_label=(interp.noise_label if interp else ""),
                loudness_label=(interp.loudness_label if interp else ""),
                clarity_label=(interp.clarity_label if interp else ""),
                speech_rate=(interp.speech_rate if interp else None),
                speech_rate_label=(interp.speech_rate_label if interp else ""),
                silence_ratio=(interp.silence_ratio if interp else None),
                sentiment=(text_analysis.sentiment.overall_label if text_analysis and text_analysis.sentiment else ""),
                emotion=(text_analysis.emotion if text_analysis else ""),
                quality_score=(quality.overall_score if quality else None),
                adjusted_quality_score=(quality.adjusted_overall_score if quality else None),
                quality_rating=(quality.rating if quality else ""),
                noise_root_causes=(quality.background_noise.dominant_causes if quality and quality.background_noise else []),
                duration_sec=analysis_result.duration,
            )
            verdict_data = await _generate_audio_verdict_raw(verdict_payload)
            analysis_result.verdict = AudioVerdict(
                title=verdict_data.get("verdict", {}).get("title", ""),
                description=verdict_data.get("verdict", {}).get("description", ""),
            )
            analysis_result.recommended_actions = verdict_data.get("recommended_actions", [])
        except Exception as verdict_exc:
            logger.warning("Non-fatal: verdict generation skipped: %s", verdict_exc)

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
#  Audio Verdict — LLM decision layer (no audio sent to LLM)
#  Receives structured signal JSON, returns verdict + recommended_actions.
# ──────────────────────────────────────────────
class AudioVerdictRequest(BaseModel):
    snr: float | None = None
    noise_label: str = ""
    loudness_label: str = ""
    clarity_label: str = ""
    speech_rate: float | None = None
    speech_rate_label: str = ""
    silence_ratio: float | None = None
    sentiment: str = ""
    emotion: str = ""
    quality_score: float | None = None
    adjusted_quality_score: float | None = None
    quality_rating: str = ""
    noise_root_causes: list[str] = []
    duration_sec: float | None = None


class AudioChatRequest(BaseModel):
    transcript_text: str
    question: str
    history: list[dict] = []


@router.post("/audio-chat")
async def audio_chat(payload: AudioChatRequest):
    """
    Multi-turn chat grounded on an analyzed audio transcript.
    """
    question = (payload.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    transcript = (payload.transcript_text or "").strip()
    if not transcript:
        raise HTTPException(status_code=400, detail="Transcript context is required.")

    settings = get_settings()
    if not settings.groq_api_key:
        raise HTTPException(status_code=503, detail="GROQ_API_KEY not configured")

    # Normalize and cap history turns to avoid oversized payloads.
    history: list[dict] = []
    for msg in payload.history[-10:]:
        role = str(msg.get("role", "")).strip()
        content = str(msg.get("content", "")).strip()
        if role in {"user", "assistant"} and content:
            history.append({"role": role, "content": content})

    try:
        service = TextAnalysisService()
        answer = await service.chat_with_transcript(transcript, history, question)
        return {"answer": answer, "model": settings.groq_model}
    except Exception as exc:
        logger.error("audio-chat LLM error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


VERDICT_SYSTEM_PROMPT = """You are an expert audio analysis assistant. Given structured audio signal metrics, you will:
1. Write a punchy 4-8 word verdict TITLE (e.g. "Low Quality Audio | Nostalgic Tone")
2. Write a 1-2 sentence plain-English DESCRIPTION explaining what the audio is like and whether it is suitable for transcription
3. List 2-4 concise RECOMMENDED ACTIONS to improve the audio quality (if the quality is good, list 1-2 best practices instead)

Return ONLY a JSON object with exactly these keys:
{
  "title": "<4-8 word verdict title>",
  "description": "<1-2 sentence plain English explanation>",
  "recommended_actions": ["<action 1>", "<action 2>", ...]
}

Rules:
- The title should reflect BOTH quality AND tone/emotion separated by " | " (e.g. "Clear Audio | Nostalgic Tone")
- If emotion is empty or neutral, omit the tone part from the title
- Be constructive — if quality is good, acknowledge it
- Actions should be specific and actionable (e.g. "Re-record closer to the microphone" not just "improve quality")
- Return ONLY raw JSON. No markdown fences, no commentary."""


@router.post("/audio-verdict")
async def generate_audio_verdict(payload: AudioVerdictRequest):
    """
    Decision layer: receives structured audio quality signals — NOT raw audio.
    Calls Groq LLM to generate a plain-language verdict and recommended actions.
    10-second timeout; returns null verdict on failure.
    """
    try:
        return await _generate_audio_verdict_raw(payload)
    except asyncio.TimeoutError:
        logger.warning("Audio verdict LLM call timed out (10s)")
        raise HTTPException(status_code=504, detail="Verdict generation timed out")
    except Exception as exc:
        logger.error("Audio verdict LLM error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


async def _generate_audio_verdict_raw(payload: AudioVerdictRequest) -> dict:
    settings = get_settings()
    if not settings.groq_api_key:
        raise ValueError("Groq API key not configured")

    from groq import AsyncGroq
    client = AsyncGroq(api_key=settings.groq_api_key)

    signal_parts = []
    if payload.snr is not None:
        signal_parts.append(f"SNR: {payload.snr:.1f} dB ({payload.noise_label or 'unknown'})")
    if payload.loudness_label:
        signal_parts.append(f"Loudness: {payload.loudness_label}")
    if payload.clarity_label:
        signal_parts.append(f"Clarity: {payload.clarity_label}")
    if payload.speech_rate is not None and payload.speech_rate_label:
        signal_parts.append(f"Speech Rate: {payload.speech_rate:.0f} WPM ({payload.speech_rate_label})")
    if payload.silence_ratio is not None:
        signal_parts.append(f"Silence Ratio: {payload.silence_ratio * 100:.0f}%")
    if payload.sentiment:
        signal_parts.append(f"Sentiment: {payload.sentiment}")
    if payload.emotion:
        signal_parts.append(f"Emotion: {payload.emotion}")
    if payload.quality_score is not None and payload.quality_rating:
        signal_parts.append(f"Overall Quality Score: {payload.quality_score:.0f}/100 ({payload.quality_rating})")
    if payload.adjusted_quality_score is not None:
        signal_parts.append(f"Noise-Adjusted Quality Score: {payload.adjusted_quality_score:.0f}/100")
    if payload.noise_root_causes:
        signal_parts.append("Background Noise Causes: " + ", ".join(payload.noise_root_causes[:3]))
    if payload.duration_sec is not None:
        mins = int(payload.duration_sec // 60)
        secs = int(payload.duration_sec % 60)
        signal_parts.append(f"Duration: {mins}:{secs:02d}")

    user_message = "Audio signal data:\n" + "\n".join(f"- {p}" for p in signal_parts)
    resp = await asyncio.wait_for(
        client.chat.completions.create(
            model=settings.groq_model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": VERDICT_SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            temperature=0.3,
            max_tokens=400,
        ),
        timeout=10.0,
    )
    raw = resp.choices[0].message.content
    data = json.loads(raw)  # type: ignore[arg-type]
    title = str(data.get("title", "") or "").strip()
    description = str(data.get("description", "") or "").strip()
    actions_raw = data.get("recommended_actions", [])
    actions = [str(a).strip() for a in actions_raw if str(a).strip()] if isinstance(actions_raw, list) else []
    return {
        "verdict": {"title": title, "description": description},
        "recommended_actions": actions,
    }


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
async def list_datasets(q: str = "", offset: int = 0, limit: int = 20):
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
    if q.strip():
        params["filters[title]"] = q.strip()

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
                # index_name is the resource ID used to fetch sample rows
                index_name = str(item.get("index_name") or item.get("id") or "")
                # field list for schema display
                raw_fields = item.get("field") or []
                fields = [
                    {"name": str(f.get("name", "?")), "type": str(f.get("type", "unknown"))}
                    for f in raw_fields
                    if isinstance(f, dict)
                ] if isinstance(raw_fields, list) else []

                results.append({
                    "name": title,
                    "desc": str(item.get("desc") or ""),
                    "category": str(category),
                    "org": str(org_name),
                    "id": index_name,
                    "updated": str(item.get("updated") or item.get("date_last_updated") or ""),
                    "fields": fields,
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
#  Dataset Sample Preview — proxy data.gov.in resource rows
# ──────────────────────────────────────────────
@router.get("/datasets/sample/{index_id:path}")
async def get_dataset_sample(index_id: str, limit: int = 500):
    """
    Fetch up to `limit` rows from a data.gov.in resource.
    Returns { records: [...], field: [...], total: int }
    """
    settings = get_settings()
    api_key = settings.data_gov_api_key
    if not api_key:
        return {"records": [], "field": [], "total": 0, "error": "DATA_GOV_API_KEY not configured"}

    url = f"https://api.data.gov.in/resource/{index_id}"
    params = {"api-key": api_key, "format": "json", "limit": limit, "offset": 0}

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
        logger.warning("Dataset sample fetch error for %s: %s", index_id, exc)
        return {"records": [], "field": [], "total": 0, "error": str(exc)}


# ──────────────────────────────────────────────
#  Dataset Full Fetch → writes to Team 4 workspace for real analysis
# ──────────────────────────────────────────────
import csv as _csv
import re as _re
import time as _time
import uuid as _uuid
from pathlib import Path as _Path

ANALYSIS_MAX_ROWS = 100_000   # stat-grade ceiling; pandas handles this fine
FETCH_PAGE_SIZE   = 2_000     # rows per data.gov.in request

# Team 4's raw upload directory (mirror of services.py line 11)
_T4_DIR = _Path(__file__).resolve().parents[2] / "shared_workspace" / "1_raw_uploads"
_T4_DIR.mkdir(parents=True, exist_ok=True)


class FetchForAnalysisRequest(BaseModel):
    index_id: str
    dataset_name: str
    max_rows: int = ANALYSIS_MAX_ROWS


@router.post("/datasets/fetch-for-analysis")
async def fetch_dataset_for_analysis(payload: FetchForAnalysisRequest):
    """
    Streams NDJSON progress events while downloading the full dataset from
    data.gov.in server-to-server and writing it into Team 4's shared workspace.

    Event types emitted (one JSON object per line):
      {"type": "progress", "rows_fetched": int, "total": int|null, "pct": int}
      {"type": "complete", "filename": str, "rows_fetched": int,
                           "total_available": int|null, "truncated": bool}
      {"type": "error",   "message": str}
    """
    settings = get_settings()
    api_key = settings.data_gov_api_key
    if not api_key:
        # Emit a single error event — client reads it from the stream
        async def _api_key_error():
            yield json.dumps({"type": "error", "message": "DATA_GOV_API_KEY not configured on server"}) + "\n"
        return StreamingResponse(_api_key_error(), media_type="application/x-ndjson")

    max_rows = min(payload.max_rows, ANALYSIS_MAX_ROWS)
    safe_base = _re.sub(r"[^\w\-]", "_", payload.dataset_name)[:50]
    filename  = f"{safe_base}_{_uuid.uuid4().hex[:8]}.csv"
    file_path = _T4_DIR / filename
    base_url  = f"https://api.data.gov.in/resource/{payload.index_id}"

    async def _stream():
        rows_written    = 0
        total_available = None
        header_written  = False
        page_errors     = 0
        MAX_PAGE_ERRORS = 3   # tolerate transient failures; abort after 3 consecutive

        try:
            with open(file_path, "w", newline="", encoding="utf-8") as fh:
                writer = None

                # Per-page timeout of 20s; overall operation bounded by max_rows / PAGE_SIZE pages
                async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10, read=20, write=10, pool=5)) as client:
                    offset = 0
                    while rows_written < max_rows:
                        page_limit = min(FETCH_PAGE_SIZE, max_rows - rows_written)
                        params = {
                            "api-key": api_key,
                            "format":  "json",
                            "limit":   page_limit,
                            "offset":  offset,
                        }
                        try:
                            resp = await client.get(base_url, params=params)
                            resp.raise_for_status()
                            data = resp.json()
                            page_errors = 0   # reset on success
                        except httpx.TimeoutException as exc:
                            page_errors += 1
                            logger.warning("Page timeout (offset=%d, attempt=%d): %s", offset, page_errors, exc)
                            if page_errors >= MAX_PAGE_ERRORS:
                                if rows_written == 0:
                                    file_path.unlink(missing_ok=True)
                                    yield json.dumps({"type": "error", "message": f"data.gov.in timed out after {MAX_PAGE_ERRORS} retries. Try again later."}) + "\n"
                                    return
                                # Partial data is better than nothing — stop and return what we have
                                break
                            await asyncio.sleep(1)
                            continue
                        except httpx.HTTPStatusError as exc:
                            page_errors += 1
                            status = exc.response.status_code
                            if status == 404:
                                yield json.dumps({"type": "error", "message": "Resource not found on data.gov.in. The dataset may have been removed."}) + "\n"
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
                            writer.writerow(record)  # type: ignore[union-attr]
                            rows_written += 1

                        offset += len(records)

                        # Emit a progress event after each page
                        pct = int((rows_written / min(max_rows, total_available or max_rows)) * 100) if total_available else 0
                        yield json.dumps({
                            "type":         "progress",
                            "rows_fetched": rows_written,
                            "total":        total_available,
                            "pct":          min(pct, 99),   # reserve 100% for complete event
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


# ──────────────────────────────────────────────
#  Dataset Full CSV Download — paginated proxy stream
# ──────────────────────────────────────────────
MAX_DOWNLOAD_ROWS = 100_000  # matches ANALYSIS_MAX_ROWS — consistent cap across both paths

@router.get("/datasets/download/{index_id:path}")
async def download_dataset_csv(index_id: str, filename: str = "dataset"):
    """
    Streams the full dataset from data.gov.in as a CSV file download.
    Paginates through the resource API (1 000 rows per page) up to MAX_DOWNLOAD_ROWS.
    The API key stays server-side — never exposed to the browser.
    """
    import csv
    import io

    settings = get_settings()
    api_key = settings.data_gov_api_key
    if not api_key:
        raise HTTPException(status_code=503, detail="DATA_GOV_API_KEY not configured")

    base_url = f"https://api.data.gov.in/resource/{index_id}"
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
                    "api-key": api_key,
                    "format": "json",
                    "limit": min(PAGE_SIZE, MAX_DOWNLOAD_ROWS - rows_written),
                    "offset": offset,
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
                    break   # no more data

                for record in records:
                    if csv_writer is None:
                        # Write header on very first record
                        headers = list(record.keys())
                        csv_writer = csv.DictWriter(
                            writer_buf,
                            fieldnames=headers,
                            extrasaction="ignore",
                            lineterminator="\n",
                        )
                        if first_page:
                            csv_writer.writeheader()
                            first_page = False

                    csv_writer.writerow(record)
                    rows_written += 1

                # Flush buffer and yield
                chunk = writer_buf.getvalue()
                writer_buf.truncate(0)
                writer_buf.seek(0)
                if chunk:
                    yield chunk.encode("utf-8")

                total = int(data.get("total", 0))
                offset += len(records)
                if offset >= total:
                    break   # fetched everything the API has

        # Append download cap note as a CSV comment if we hit the limit
        if rows_written >= MAX_DOWNLOAD_ROWS:
            yield f"\n# Download capped at {MAX_DOWNLOAD_ROWS:,} rows. Visit data.gov.in for the full dataset.\n".encode("utf-8")

    safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in filename)[:60].strip() or "dataset"
    headers = {
        "Content-Disposition": f'attachment; filename="{safe_name}.csv"',
        "Content-Type": "text/csv; charset=utf-8",
        "X-Accel-Buffering": "no",   # disable nginx buffering so chunks arrive live
    }
    return StreamingResponse(csv_stream(), headers=headers, media_type="text/csv")


# ──────────────────────────────────────────────
#  Dataset AI Chat — LLM analysis of a catalog dataset
# ──────────────────────────────────────────────
class DatasetChatRequest(BaseModel):
    dataset_name: str
    description: str
    fields: list[dict] = []
    question: str
    history: list[dict] = []


@router.post("/datasets/chat")
async def chat_about_dataset(payload: DatasetChatRequest):
    """Answer a question about a data.gov.in dataset using its metadata as context."""
    from openai import AsyncOpenAI
    settings = get_settings()

    if settings.nvidia_api_key:
        client = AsyncOpenAI(base_url="https://integrate.api.nvidia.com/v1", api_key=settings.nvidia_api_key)
        model_name = settings.nvidia_model
    else:
        client = AsyncOpenAI(base_url="https://api.groq.com/openai/v1", api_key=settings.groq_api_key)
        model_name = settings.groq_model

    # Build schema context
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
        return {"answer": resp.choices[0].message.content.strip(), "model": model_name}
    except Exception as exc:
        logger.error("dataset-chat LLM error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


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
