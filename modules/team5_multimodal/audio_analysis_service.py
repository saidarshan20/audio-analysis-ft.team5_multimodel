"""
audio_analysis_service.py - Handles audio transcription, speaker diarization,
and orchestrates text analysis.

Extended to integrate AudioFeatureExtractor for acoustic feature extraction
(waveform, spectrogram, RMS energy) as part of Task 1 & Task 2.
"""

import os
import io
import tempfile
import shutil
import time
import soundfile as sf
import numpy as np
import torch
import whisper
import logging
import asyncio

# pyannote.audio is optional — requires HF token + accepted usage terms on HuggingFace.
# If not installed, speaker diarization is silently skipped (segments get UNKNOWN speaker).
try:
    from pyannote.audio import Pipeline as _PyannotePipeline
    _PYANNOTE_OK = True
except ImportError:
    _PyannotePipeline = None  # type: ignore[assignment, misc]
    _PYANNOTE_OK = False
    logging.getLogger(__name__).warning(
        "pyannote.audio not installed — speaker diarization disabled. "
        "Install with: pip install pyannote.audio  (requires HF token)"
    )

from dotenv import load_dotenv
from pydub import AudioSegment

load_dotenv()

from modules.team5_multimodal.config import get_settings
from modules.team5_multimodal.models import AudioAnalysisResult, AudioFeatures, SpeakerSegment
from modules.team5_multimodal.services import TextAnalysisService
from modules.team5_multimodal.audio_feature_extractor import AudioFeatureExtractor

logger = logging.getLogger(__name__)

# Cache models to avoid reloading on every request
_whisper_model = None
_diarize_pipeline = None


def get_whisper_model(model_name="base"):
    global _whisper_model
    if _whisper_model is None:
        logger.info(f"Loading Whisper model ({model_name})...")
        _whisper_model = whisper.load_model(model_name)
    return _whisper_model


def get_diarization_pipeline():
    global _diarize_pipeline
    if not _PYANNOTE_OK:
        raise RuntimeError(
            "pyannote.audio is not installed. Install it with:\n"
            "  pip install pyannote.audio\n"
            "Then accept model usage terms at:\n"
            "  https://huggingface.co/pyannote/speaker-diarization-3.1\n"
            "  https://huggingface.co/pyannote/segmentation-3.0"
        )
    if _diarize_pipeline is None:
        token = get_settings().hf_token
        if not token:
            raise ValueError("HF_TOKEN is not set in config/.env for pyannote.audio")
        logger.info("Loading pyannote diarization pipeline...")
        _diarize_pipeline = _PyannotePipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            token=token,
        )
        # Move to CPU explicitly, or GPU if available
        _diarize_pipeline.to(torch.device("cuda" if torch.cuda.is_available() else "cpu"))
    return _diarize_pipeline


class AudioAnalysisService:
    def __init__(self):
        self.settings = get_settings()
        self.text_analysis_svc = TextAnalysisService()
        self.max_size_mb = 50
        self.max_duration_sec = 5 * 60
        self.ffmpeg_error = self._configure_ffmpeg()
        # Feature extractor for acoustic analysis (Task 1)
        self._feature_extractor = AudioFeatureExtractor(
            ffmpeg_exe=self.settings.ffmpeg_path or "",
            ffprobe_exe=self.settings.ffprobe_path or "",
        )

    def process_audio(self, file_bytes: bytes, filename: str) -> AudioAnalysisResult:
        """
        Main pipeline: Convert -> Enforce limits -> Extract features
                       -> Transcribe -> Diarize -> Align segments
        """
        if self.ffmpeg_error:
            raise ValueError(self.ffmpeg_error)

        # 1. Enforce size limit
        if len(file_bytes) > self.max_size_mb * 1024 * 1024:
            raise ValueError(f"File size exceeds {self.max_size_mb} MB limit.")

        logger.info(f"Processing audio: {filename} ({len(file_bytes)} bytes)")

        # Create temporary directory to safely handle file conversions
        tmpdir = tempfile.mkdtemp(prefix="audio_upload_")
        raw_path = None
        wav_path = None
        try:
            _, ext = os.path.splitext(filename or "")
            ext = ext.lower()
            if ext and not ext.startswith("."):
                ext = f".{ext}"
            raw_path = os.path.join(tmpdir, f"raw_upload{ext or ''}")
            with open(raw_path, "wb") as f:
                f.write(file_bytes)

            # 2. Conversion and Duration Check
            wav_path = os.path.join(tmpdir, "processed.wav")
            audio = AudioSegment.from_file(raw_path, format=ext.lstrip(".") or None)
            duration_sec = len(audio) / 1000.0

            logger.info(f"Audio duration: {duration_sec}s")
            if duration_sec > self.max_duration_sec:
                raise ValueError(f"Audio duration exceeds {self.max_duration_sec/60} minutes limit.")

            audio.export(wav_path, format="wav")

            # 3. Extract acoustic features (Task 1 — feature extraction)
            features_pydantic = self._safe_extract_features(file_bytes, filename)

            # 4. Transcribe
            transcript_segs = self._transcribe(wav_path)

            # 5. Diarize (best effort: continue without speaker IDs if gated model unavailable)
            speaker_segs = self._safe_diarize(wav_path)

            # 6. Align transcription with diarization
            aligned_segments = self._align(transcript_segs, speaker_segs)

            # Format full text
            transcript_text = " ".join([s.text for s in aligned_segments])

            return AudioAnalysisResult(
                duration=duration_sec,
                segments=aligned_segments,
                transcript_text=transcript_text,
                features=features_pydantic,  # ← Task 1 acoustic features attached here
            )

        except Exception as e:
            logger.exception("Error in audio format conversion or processing")
            raise ValueError(f"Failed to process audio: {str(e)}")
        finally:
            self._cleanup_tmpdir(tmpdir)

    def _safe_extract_features(self, file_bytes: bytes, filename: str) -> AudioFeatures | None:
        """
        Extract acoustic features via AudioFeatureExtractor (Task 1).
        Returns None gracefully if librosa/pydub are not installed or extraction fails,
        so the rest of the pipeline (STT, diarization) still completes.
        """
        try:
            raw = self._feature_extractor.extract(
                file_bytes,
                filename,
                include_mfcc=False,  # MFCCs optional, off by default
            )
            # Use from_attributes=True so Pydantic reads nested dataclass
            # attributes recursively (WaveformData, SpectrogramData, etc.)
            return AudioFeatures.model_validate(raw, from_attributes=True)
        except Exception as exc:
            logger.warning("Acoustic feature extraction failed (non-fatal): %s", exc)
            return None

    def _resolve_binary_path(self, configured_path: str, exe_name: str) -> str | None:
        if configured_path:
            configured_path = configured_path.strip().strip('"')
            candidate = configured_path
            if os.path.isdir(candidate):
                candidate = os.path.join(candidate, exe_name)
            if os.path.isfile(candidate):
                return os.path.abspath(candidate)

        found = shutil.which(exe_name)
        return os.path.abspath(found) if found else None

    def _prepend_path_dirs(self, dirs: list[str]) -> None:
        current = os.environ.get("PATH", "")
        existing = current.split(os.pathsep) if current else []
        norm_existing = {os.path.normcase(os.path.normpath(p)) for p in existing if p}
        to_add = []
        for d in dirs:
            if not d:
                continue
            norm_d = os.path.normcase(os.path.normpath(d))
            if norm_d not in norm_existing:
                to_add.append(d)
        if to_add:
            os.environ["PATH"] = os.pathsep.join(to_add + existing)

    def _configure_ffmpeg(self) -> str | None:
        ffmpeg_cfg = self.settings.ffmpeg_path or os.environ.get("FFMPEG_PATH", "")
        ffprobe_cfg = self.settings.ffprobe_path or os.environ.get("FFPROBE_PATH", "")
        ffmpeg_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
        ffprobe_name = "ffprobe.exe" if os.name == "nt" else "ffprobe"

        ffmpeg_exe = self._resolve_binary_path(ffmpeg_cfg, ffmpeg_name)
        ffprobe_exe = self._resolve_binary_path(ffprobe_cfg, ffprobe_name)

        if ffmpeg_exe and ffprobe_exe:
            # Older pydub resolves ffprobe only via PATH, so ensure bin dirs are present.
            self._prepend_path_dirs([os.path.dirname(ffmpeg_exe), os.path.dirname(ffprobe_exe)])
            AudioSegment.converter = ffmpeg_exe
            return None

        return (
            "ffmpeg/ffprobe not found. Install ffmpeg and add it to PATH, "
            "or set FFMPEG_PATH and FFPROBE_PATH in your environment."
        )

    def _cleanup_tmpdir(self, tmpdir: str) -> None:
        if not tmpdir:
            return
        # On Windows, ffmpeg can keep a handle briefly; retry a few times.
        for attempt in range(5):
            try:
                shutil.rmtree(tmpdir)
                return
            except PermissionError:
                time.sleep(0.2 * (attempt + 1))
        shutil.rmtree(tmpdir, ignore_errors=True)

    def _transcribe(self, audio_path: str):
        model = get_whisper_model()
        result = model.transcribe(audio_path, word_timestamps=True)
        return [
            {"start": s["start"], "end": s["end"], "text": s["text"].strip()}
            for s in result["segments"]
        ]

    def _diarize(self, audio_path: str):
        pipeline = get_diarization_pipeline()

        waveform_np, sample_rate = sf.read(audio_path, dtype="float32", always_2d=True)
        # Handle stereo to mono if needed, though pyannote can accept 2D
        if waveform_np.shape[1] > 1:
            waveform_np = waveform_np.mean(axis=1, keepdims=True)

        waveform = torch.tensor(waveform_np.T)
        audio_input = {"waveform": waveform, "sample_rate": sample_rate}

        diarization = pipeline(audio_input)

        # Handle PyAnnote 3.1 return type variations depending on the pipeline
        if hasattr(diarization, "itertracks"):
            tracks = diarization.itertracks(yield_label=True)
        elif hasattr(diarization, "speaker_diarization") and hasattr(
            diarization.speaker_diarization, "itertracks"
        ):
            tracks = diarization.speaker_diarization.itertracks(yield_label=True)
        else:
            tracks = []

        speaker_segments = []
        for turn, _, speaker in tracks:
            speaker_segments.append({
                "start":   round(turn.start, 3),
                "end":     round(turn.end,   3),
                "speaker": speaker,
            })
        return speaker_segments

    def _safe_diarize(self, audio_path: str):
        try:
            return self._diarize(audio_path)
        except Exception as e:
            msg = str(e)
            gated_model_error = (
                "Cannot access gated repo" in msg
                or "restricted and you are not in the authorized list" in msg
                or "401 Client Error" in msg
                or "403 Client Error" in msg
            )
            if gated_model_error:
                logger.warning(
                    "Diarization skipped: gated pyannote model access denied. "
                    "Proceeding with UNKNOWN speaker labels."
                )
                return []
            logger.warning(
                "Diarization failed; proceeding with UNKNOWN speaker labels: %s", e
            )
            return []

    def _align(self, transcript_segs, speaker_segs) -> list[SpeakerSegment]:
        results = []
        for tseg in transcript_segs:
            t_start, t_end = tseg["start"], tseg["end"]
            best_speaker, best_overlap = "UNKNOWN", 0.0

            for sseg in speaker_segs:
                overlap = min(t_end, sseg["end"]) - max(t_start, sseg["start"])
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_speaker = sseg["speaker"]

            results.append(SpeakerSegment(
                start=tseg["start"],
                end=tseg["end"],
                speaker=best_speaker,
                text=tseg["text"]
            ))
        return results

    async def analyze_transcript(self, transcript_text: str):
        """Passes the generated text to the existing text analysis service."""
        try:
            return await self.text_analysis_svc.analyze(transcript_text)
        except Exception as e:
            logger.warning(f"Text analysis on transcript failed: {e}")
            return None
