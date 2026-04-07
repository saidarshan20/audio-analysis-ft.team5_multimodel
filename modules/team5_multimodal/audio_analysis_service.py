"""
audio_analysis_service.py - Handles audio transcription, speaker diarization,
and orchestrates text analysis.
"""

import os
import io
import tempfile
import soundfile as sf
import numpy as np
import torch
import whisper
from pyannote.audio import Pipeline
from pydub import AudioSegment
import logging
import asyncio

from modules.team5_multimodal.config import get_settings
from modules.team5_multimodal.models import AudioAnalysisResult, SpeakerSegment
from modules.team5_multimodal.services import TextAnalysisService

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
    if _diarize_pipeline is None:
        token = get_settings().hf_token
        if not token:
            raise ValueError("HF_TOKEN is not set in config/.env for pyannote.audio")
        logger.info("Loading pyannote diarization pipeline...")
        _diarize_pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            token=token,
        )
        # Move to CPU explicitly, or GPU if available and preferred
        _diarize_pipeline.to(torch.device("cuda" if torch.cuda.is_available() else "cpu"))
    return _diarize_pipeline


class AudioAnalysisService:
    def __init__(self):
        self.settings = get_settings()
        self.text_analysis_svc = TextAnalysisService()
        self.max_size_mb = 50
        self.max_duration_sec = 5 * 60

    def process_audio(self, file_bytes: bytes, filename: str) -> AudioAnalysisResult:
        """
        Main pipeline: Convert -> Enforce limits -> Transcribe -> Diarize -> Merging
        """
        # 1. Enforce size limit
        if len(file_bytes) > self.max_size_mb * 1024 * 1024:
            raise ValueError(f"File size exceeds {self.max_size_mb} MB limit.")

        logger.info(f"Processing audio: {filename} ({len(file_bytes)} bytes)")

        # Create temporary directory to safely handle file conversions
        with tempfile.TemporaryDirectory() as tmpdir:
            raw_path = os.path.join(tmpdir, "raw_upload")
            with open(raw_path, "wb") as f:
                f.write(file_bytes)

            try:
                # 2. Conversion and Duration Check
                wav_path = os.path.join(tmpdir, "processed.wav")
                audio = AudioSegment.from_file(raw_path)
                duration_sec = len(audio) / 1000.0
                
                logger.info(f"Audio duration: {duration_sec}s")
                if duration_sec > self.max_duration_sec:
                    raise ValueError(f"Audio duration exceeds {self.max_duration_sec/60} minutes limit.")

                audio.export(wav_path, format="wav")

                # 3. Transcribe
                transcript_segs = self._transcribe(wav_path)

                # 4. Diarize
                speaker_segs = self._diarize(wav_path)

                # 5. Align
                aligned_segments = self._align(transcript_segs, speaker_segs)
                
                # Format full text
                transcript_text = " ".join([s.text for s in aligned_segments])

                return AudioAnalysisResult(
                    duration=duration_sec,
                    segments=aligned_segments,
                    transcript_text=transcript_text
                )

            except Exception as e:
                logger.exception("Error in audio format conversion or processing")
                raise ValueError(f"Failed to process audio: {str(e)}")


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
        # For simplicity, convert to mono for diarization if 2 channels
        if waveform_np.shape[1] > 1:
             waveform_np = waveform_np.mean(axis=1, keepdims=True)

        waveform = torch.tensor(waveform_np.T)
        audio_input = {"waveform": waveform, "sample_rate": sample_rate}

        diarization = pipeline(audio_input)

        # Handle PyAnnote 3.1 return type variations depending on the pipeline
        if hasattr(diarization, "itertracks"):
             tracks = diarization.itertracks(yield_label=True)
        elif hasattr(diarization, "speaker_diarization") and hasattr(diarization.speaker_diarization, "itertracks"):
             tracks = diarization.speaker_diarization.itertracks(yield_label=True)
        else:
             # Fallback
             tracks = []

        speaker_segments = []
        for turn, _, speaker in tracks:
            speaker_segments.append({
                "start":   round(turn.start, 3),
                "end":     round(turn.end,   3),
                "speaker": speaker,
            })
        return speaker_segments

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
