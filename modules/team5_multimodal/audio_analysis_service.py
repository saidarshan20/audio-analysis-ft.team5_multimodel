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
from modules.team5_multimodal.models import (
    AudioAnalysisResult,
    AudioFeatures,
    AudioQuality,
    AudioVerdict,
    AudioInterpretation,
    BackgroundNoiseSummary,
    AudioScoreComponents,
    SpeakerSegment,
    SpeakerMetrics,
)
from modules.team5_multimodal.services import TextAnalysisService
from modules.team5_multimodal.audio_feature_extractor import AudioFeatureExtractor
from modules.team5_multimodal.audio_quality_service import AudioQualityService
from modules.team5_multimodal.yamnet_service import YamnetNoiseService

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
        self._quality_service = AudioQualityService()
        self._yamnet_service = YamnetNoiseService(self.settings)

    def process_audio(self, file_bytes: bytes, filename: str) -> AudioAnalysisResult:
        """
        Main pipeline:
          1) Validate file size + runtime
          2) Convert to normalized WAV (16k mono)
          3) Run all downstream analysis on that WAV only
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

            # 2. Runtime check (duration) on uploaded input, before conversion.
            input_audio = self._decode_audio_any(raw_path, ext.lstrip("."))
            duration_sec = len(input_audio) / 1000.0
            logger.info("Audio duration (input): %.2fs", duration_sec)
            if duration_sec > self.max_duration_sec:
                raise ValueError(f"Audio duration exceeds {self.max_duration_sec/60} minutes limit.")

            # 3. Convert to normalized WAV (16 kHz mono) once.
            wav_path = os.path.join(tmpdir, "processed.wav")
            input_audio.set_channels(1).set_frame_rate(16_000).export(wav_path, format="wav")

            # 4. Extract acoustic features from WAV only
            features_pydantic = self._safe_extract_features_from_wav(wav_path)
            quality = self._safe_score_audio_quality(
                wav_path,
                input_had_multiple_channels=input_audio.channels > 1,
            )
            background_noise = self._safe_detect_background_noise(wav_path)
            quality = self._apply_noise_adjustment(quality, background_noise)

            # 5. Transcribe (WAV only)
            transcript_out = self._transcribe(wav_path)
            transcript_segs = transcript_out["segments"]
            language = transcript_out.get("language", "")

            # 6. Diarize (best effort: continue without speaker IDs if gated model unavailable)
            speaker_segs = self._safe_diarize(wav_path)

            # 7. Align transcription with diarization
            aligned_segments = self._align(transcript_segs, speaker_segs)

            # Format full text
            transcript_text = " ".join([s.text for s in aligned_segments])

            # ── Speaker metrics: WPM, dominance, participation, interruptions ──
            interruption_count = 0
            speaker_metrics_raw: dict[str, dict] = {}
            total_duration = 0.0

            for idx, seg in enumerate(aligned_segments):
                s_id = seg.speaker
                if s_id not in speaker_metrics_raw:
                    speaker_metrics_raw[s_id] = {"words": 0, "duration": 0.0, "segments": 0}
                speaker_metrics_raw[s_id]["words"] += len(seg.text.split())
                seg_dur = seg.end - seg.start
                speaker_metrics_raw[s_id]["duration"] += seg_dur
                speaker_metrics_raw[s_id]["segments"] += 1
                total_duration += seg_dur
                if idx > 0:
                    prev = aligned_segments[idx - 1]
                    if prev.speaker != seg.speaker and seg.start < prev.end - 0.5:
                        interruption_count += 1

            total_segs = len(aligned_segments)

            # ── Per-speaker pitch from diarized WAV segments ──
            speaker_pitch = self._compute_per_speaker_pitch(
                wav_path, speaker_segs, speaker_metrics_raw
            )

            speaker_metrics_final: dict[str, SpeakerMetrics] = {}
            for s_id, data in speaker_metrics_raw.items():
                wpm = (data["words"] / (data["duration"] / 60.0)) if data["duration"] > 0 else 0
                dominance = (data["duration"] / total_duration) if total_duration > 0 else 0
                participation = (data["segments"] / total_segs) if total_segs > 0 else 0
                p_mean, p_tag = speaker_pitch.get(s_id, (None, ""))
                speaker_metrics_final[s_id] = SpeakerMetrics(
                    wpm=float(wpm),
                    dominance_ratio=float(dominance),
                    participation_ratio=float(participation),
                    pitch_mean=p_mean,
                    gender_tag=p_tag,
                )

            # ── 8. Build rule-based interpretation ──────────────────────────────
            word_count = len(transcript_text.split()) if transcript_text else 0
            interp = self._build_interpretation(
                quality,
                word_count,
                duration_sec,
                dominant_noise_causes=(quality.background_noise.dominant_causes if quality.background_noise else []),
            )

            # Generate Word Cloud
            word_cloud_base64 = None
            if transcript_text.strip():
                try:
                    from wordcloud import WordCloud
                    import base64
                    from io import BytesIO
                    wc = WordCloud(width=800, height=400, background_color="rgba(15, 23, 42, 0)", mode="RGBA").generate(transcript_text)
                    img = wc.to_image()
                    buf = BytesIO()
                    img.save(buf, format="PNG")
                    word_cloud_base64 = base64.b64encode(buf.getvalue()).decode('utf-8')
                except Exception as e:
                    logger.warning(f"Word cloud generation failed: {e}")

            return AudioAnalysisResult(
                duration=duration_sec,
                segments=aligned_segments,
                transcript_text=transcript_text,
                features=features_pydantic,
                language=language,
                interruption_count=interruption_count,
                speaker_metrics=speaker_metrics_final,
                audio_quality=quality,
                interpretation=interp,
                word_cloud_base64=word_cloud_base64,
            )

        except Exception as e:
            logger.exception("Error in audio format conversion or processing")
            raise ValueError(f"Failed to process audio: {str(e)}")
        finally:
            self._cleanup_tmpdir(tmpdir)

    def _safe_extract_features_from_wav(self, wav_path: str) -> AudioFeatures | None:
        """
        Extract acoustic features from the normalized WAV path.
        Returns None gracefully if librosa/pydub are not installed or extraction fails,
        so the rest of the pipeline (STT, diarization) still completes.
        """
        try:
            raw = self._feature_extractor.extract_from_wav_path(
                wav_path,
                include_mfcc=False,  # MFCCs optional, off by default
            )
            # Use from_attributes=True so Pydantic reads nested dataclass
            # attributes recursively (WaveformData, SpectrogramData, etc.)
            return AudioFeatures.model_validate(raw, from_attributes=True)
        except Exception as exc:
            logger.warning("Acoustic feature extraction failed (non-fatal): %s", exc)
            return None

    def _safe_score_audio_quality(
        self,
        wav_path: str,
        *,
        input_had_multiple_channels: bool,
    ) -> AudioQuality:
        raw_quality = self._quality_service.score_wav(
            wav_path,
            input_had_multiple_channels=input_had_multiple_channels,
        )
        return AudioQuality.model_validate(raw_quality)

    def _safe_detect_background_noise(self, wav_path: str) -> BackgroundNoiseSummary | None:
        try:
            raw = self._yamnet_service.analyze_wav(wav_path)
            if not raw:
                return None
            return BackgroundNoiseSummary.model_validate(raw)
        except Exception as exc:
            logger.warning("YAMNet background-noise detection failed (non-fatal): %s", exc)
            return None

    @staticmethod
    def _apply_noise_adjustment(
        quality: AudioQuality,
        background_noise: BackgroundNoiseSummary | None,
    ) -> AudioQuality:
        quality.background_noise = background_noise
        base_score = quality.overall_score
        penalty = background_noise.noise_penalty_points if background_noise else 0.0
        if base_score is None:
            quality.noise_penalty_points = 0.0
        else:
            quality.noise_penalty_points = round(float(max(penalty, 0.0)), 2)

        if base_score is not None:
            quality.adjusted_overall_score = round(float(np.clip(base_score - quality.noise_penalty_points, 0.0, 100.0)), 2)
        else:
            quality.adjusted_overall_score = None

        quality.score_components = AudioScoreComponents(
            base_overall_score=base_score,
            noise_penalty_points=quality.noise_penalty_points,
            adjusted_overall_score=quality.adjusted_overall_score,
            dominant_causes=background_noise.dominant_causes if background_noise else [],
        )
        return quality

    @staticmethod
    def _build_interpretation(
        quality: AudioQuality,
        word_count: int,
        duration_sec: float,
        dominant_noise_causes: list[str] | None = None,
    ) -> AudioInterpretation:
        """
        Convert raw quality scores into human-readable labels.
        This is purely rule-based — no LLM call.
        """
        # ── Noise label from SNR ─────────────────────────────────────────────
        snr = quality.snr_db if quality.snr_db is not None else -1
        if not quality.is_speech_present or snr < 0:
            noise_label = "Unscored"
        elif snr < 10:
            noise_label = "High Noise"
        elif snr < 20:
            noise_label = "Moderate Noise"
        else:
            noise_label = "Clean Audio"

        # ── Loudness label from loudness score ───────────────────────────────
        loudness_score = quality.metrics.loudness if quality.metrics else None
        if loudness_score is None:
            loudness_label = "Unscored"
        elif loudness_score < 35:
            loudness_label = "Too Quiet"
        elif loudness_score <= 70:
            loudness_label = "Normal"
        else:
            loudness_label = "Too Loud"

        # ── Clarity label from clarity score ─────────────────────────────────
        clarity_score = quality.metrics.clarity if quality.metrics else None
        if clarity_score is None:
            clarity_label = "Unscored"
        elif clarity_score < 35:
            clarity_label = "Low"
        elif clarity_score <= 65:
            clarity_label = "Moderate"
        else:
            clarity_label = "High"

        # ── Speech rate from word count + duration ───────────────────────────
        duration_min = duration_sec / 60.0 if duration_sec > 0 else 0
        speech_rate = round(word_count / duration_min, 1) if duration_min > 0 else 0.0
        if speech_rate < 120:
            speech_rate_label = "Slow"
        elif speech_rate <= 200:
            speech_rate_label = "Normal"
        else:
            speech_rate_label = "Fast"

        # ── Silence ratio from speech_frame_ratio ───────────────────────────
        silence_ratio = round(1.0 - quality.speech_frame_ratio, 4)

        return AudioInterpretation(
            noise_label=noise_label,
            noise_root_cause=", ".join((dominant_noise_causes or [])[:3]),
            loudness_label=loudness_label,
            clarity_label=clarity_label,
            speech_rate_label=speech_rate_label,
            silence_ratio=silence_ratio,
            speech_rate=speech_rate,
        )

    @staticmethod
    def _normalize_input_ext(ext_hint: str) -> str:
        ext = (ext_hint or "").strip().lower().lstrip(".")
        alias = {
            "wave": "wav",
            "mpga": "mp3",
            "oga": "ogg",
            "m4b": "m4a",
        }
        return alias.get(ext, ext)

    def _decode_audio_any(self, raw_path: str, ext_hint: str = "") -> AudioSegment:
        """
        Robust decode for uploaded audio: try auto-detection first, then
        common codec/container hints (mp3/mpeg/m4a/ogg/flac/aac/webm/opus...).
        """
        try:
            return AudioSegment.from_file(raw_path)
        except Exception:
            pass

        ext = self._normalize_input_ext(ext_hint)
        candidates: list[str] = []
        if ext:
            candidates.append(ext)
            if ext == "mpeg":
                candidates.extend(["mp3", "mp2"])
            if ext == "mp3":
                candidates.append("mpeg")
            if ext == "m4a":
                candidates.append("mp4")

        candidates.extend(["wav", "mp3", "mpeg", "m4a", "mp4", "ogg", "flac", "aac", "webm", "opus", "wma"])

        seen: set[str] = set()
        for fmt in candidates:
            if not fmt or fmt in seen:
                continue
            seen.add(fmt)
            try:
                return AudioSegment.from_file(raw_path, format=fmt)
            except Exception:
                continue

        raise ValueError("Unsupported or corrupted audio file. Please upload a valid audio format.")

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
        is_win = os.name == "nt"
        ffmpeg_name   = "ffmpeg.exe"  if is_win else "ffmpeg"
        ffprobe_name  = "ffprobe.exe" if is_win else "ffprobe"

        # Support FFMPEG_DIR env var (a directory containing both ffmpeg + ffprobe binaries)
        ffmpeg_dir_env = os.environ.get("FFMPEG_DIR", "")
        if ffmpeg_dir_env:
            base = os.path.join(os.path.dirname(os.path.abspath(__file__)), ffmpeg_dir_env) \
                   if not os.path.isabs(ffmpeg_dir_env) else ffmpeg_dir_env
            ffmpeg_cfg  = os.path.join(base, ffmpeg_name)
            ffprobe_cfg = os.path.join(base, ffprobe_name)
        else:
            ffmpeg_cfg  = self.settings.ffmpeg_path  or os.environ.get("FFMPEG_PATH",  "")
            ffprobe_cfg = self.settings.ffprobe_path or os.environ.get("FFPROBE_PATH", "")

        ffmpeg_exe  = self._resolve_binary_path(ffmpeg_cfg,  ffmpeg_name)
        ffprobe_exe = self._resolve_binary_path(ffprobe_cfg, ffprobe_name)

        if ffmpeg_exe and ffprobe_exe:
            # Prepend bin dirs so pydub can resolve both binaries via PATH too.
            self._prepend_path_dirs([os.path.dirname(ffmpeg_exe), os.path.dirname(ffprobe_exe)])
            # Set pydub class attributes explicitly (PATH alone is not always enough).
            AudioSegment.converter = ffmpeg_exe
            AudioSegment.ffprobe   = ffprobe_exe
            logger.info("ffmpeg configured: %s | ffprobe: %s", ffmpeg_exe, ffprobe_exe)
            return None

        return (
            "ffmpeg/ffprobe not found. Install ffmpeg and add it to PATH, "
            "or set FFMPEG_PATH / FFPROBE_PATH (or FFMPEG_DIR) in your environment."
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

    def _transcribe(self, audio_path: str) -> dict:
        model = get_whisper_model()
        result = model.transcribe(audio_path, word_timestamps=True)
        return {
            "language": result.get("language", ""),
            "segments": [
                {"start": s["start"], "end": s["end"], "text": s["text"].strip()}
                for s in result["segments"]
            ]
        }

    def _compute_per_speaker_pitch(
        self,
        wav_path: str,
        speaker_segs: list[dict],
        speaker_metrics_raw: dict[str, dict],
    ) -> dict[str, tuple[float | None, str]]:
        """
        For each speaker, extract their audio frames from the WAV, compute mean F0,
        and return a dict mapping speaker_id -> (pitch_mean, gender_tag).
        Falls back gracefully if librosa is unavailable.
        """
        from modules.team5_multimodal.audio_feature_extractor import AudioFeatureExtractor
        try:
            import librosa
            import numpy as np
            y_full, sr = librosa.load(wav_path, sr=16000, mono=True)
            f0_full = librosa.yin(
                y_full,
                fmin=float(librosa.note_to_hz('C2')),
                fmax=float(librosa.note_to_hz('C7')),
                sr=sr,
                hop_length=512,
            )
            hop = 512
            result: dict[str, tuple[float | None, str]] = {}

            for s_id in speaker_metrics_raw:
                # Gather F0 frames for all segments belonging to this speaker
                all_f0 = []
                for sseg in speaker_segs:
                    if sseg.get("speaker") != s_id:
                        continue
                    start_frame = int(sseg["start"] * sr / hop)
                    end_frame = int(sseg["end"] * sr / hop)
                    chunk = f0_full[start_frame:end_frame]
                    voiced = chunk[(chunk > 60) & (chunk < 600)]
                    all_f0.extend(voiced.tolist())

                if len(all_f0) < 5:
                    result[s_id] = (None, "Indeterminate")
                else:
                    mean_f0 = float(np.mean(all_f0))
                    tag = AudioFeatureExtractor.classify_gender_from_f0(mean_f0)
                    result[s_id] = (round(mean_f0, 2), tag)

            # If no diarization happened (single UNKNOWN speaker), use global pitch
            if not speaker_segs and "UNKNOWN" in speaker_metrics_raw:
                voiced_global = f0_full[(f0_full > 60) & (f0_full < 600)]
                if len(voiced_global) >= 5:
                    mean_f0 = float(np.mean(voiced_global))
                    tag = AudioFeatureExtractor.classify_gender_from_f0(mean_f0)
                    result["UNKNOWN"] = (round(mean_f0, 2), tag)
                else:
                    result["UNKNOWN"] = (None, "Indeterminate")

            return result
        except Exception as exc:
            logger.warning("Per-speaker pitch computation failed (non-fatal): %s", exc)
            return {}

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
