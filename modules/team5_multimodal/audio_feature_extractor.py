"""
audio_feature_extractor.py - Task 1 (Audio Ingestion, Preprocessing & Feature Extraction)
Team 5 | Audio Department

Handles:
  - File ingestion (MP3 / M4A / WAV / OGG / FLAC via pydub + ffmpeg)
  - Conversion to 16 kHz mono WAV
  - Signal normalization to [-1, 1]
  - Waveform extraction (down-sampled to ~1000 pts for JSON transfer)
  - STFT spectrogram (librosa) → dB magnitude, down-sampled to 128×100
  - RMS energy timeline
  - Optional MFCCs (13 coefficients, off by default)

Tools: pydub, ffmpeg, librosa, numpy, scipy, soundfile, Python (os, shutil, tempfile)
"""

from __future__ import annotations

import io
import logging
import math
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# ── Optional heavy imports with friendly error messages ───────────────────────
try:
    import librosa
    import librosa.feature
    import librosa.util
    _LIBROSA_OK = True
except ImportError:
    librosa = None  # type: ignore[assignment]
    _LIBROSA_OK = False
    logger.warning("librosa not installed – acoustic feature extraction will be skipped.")

try:
    import soundfile as sf
    _SOUNDFILE_OK = True
except ImportError:
    sf = None  # type: ignore[assignment]
    _SOUNDFILE_OK = False
    logger.warning("soundfile not installed – will fall back to librosa loader.")

try:
    from pydub import AudioSegment
    _PYDUB_OK = True
except ImportError:
    AudioSegment = None  # type: ignore[assignment]
    _PYDUB_OK = False
    logger.warning("pydub not installed – format conversion will be skipped.")


# ─────────────────────────────────────────────────────────────────────────────
#  Data classes (plain dataclasses – Pydantic models in models.py mirror these)
# ─────────────────────────────────────────────────────────────────────────────

from dataclasses import dataclass, field


@dataclass
class WaveformData:
    timestamps: list[float]
    amplitudes: list[float]


@dataclass
class SpectrogramData:
    time_bins: list[float]       # seconds
    freq_bins: list[float]       # Hz
    magnitude_db: list[list[float]]  # [freq_idx][time_idx] in dB


@dataclass
class EnergyData:
    timestamps: list[float]
    rms_values: list[float]


@dataclass
class MFCCData:
    timestamps: list[float]
    coefficients: list[list[float]]  # [mfcc_idx][time_idx]


@dataclass
class AudioFeatures:
    sample_rate: int
    duration: float
    num_channels: int
    waveform: WaveformData
    spectrogram: SpectrogramData
    energy: EnergyData
    tempo: float = 0.0
    spectral_centroid_mean: float = 0.0
    mfcc: Optional[MFCCData] = None


# ─────────────────────────────────────────────────────────────────────────────
#  Main extractor class
# ─────────────────────────────────────────────────────────────────────────────

TARGET_SR = 16_000          # 16 kHz mono – standard for speech models
WAVEFORM_MAX_PTS = 1_000    # Down-sample waveform to this many points
SPEC_TIME_BINS = 100        # Spectrogram time axis resolution
SPEC_FREQ_BINS = 128        # Spectrogram frequency axis resolution (MEL-like)
ENERGY_MAX_PTS = 500        # RMS energy timeline resolution
MFCC_N = 13                 # Number of MFCC coefficients


class AudioFeatureExtractor:
    """
    Ingests raw audio bytes, converts to 16 kHz mono WAV, normalizes signal,
    and extracts acoustic features ready for JSON serialization.
    """

    def __init__(self, ffmpeg_exe: str = "", ffprobe_exe: str = ""):
        self._ffmpeg_exe = ffmpeg_exe
        self._ffprobe_exe = ffprobe_exe
        self._configure_ffmpeg()

    # ── Public API ────────────────────────────────────────────────────────────

    def extract(
        self,
        file_bytes: bytes,
        filename: str,
        *,
        include_mfcc: bool = False,
    ) -> AudioFeatures:
        """
        Full pipeline: ingest → convert → normalize → extract features.

        Args:
            file_bytes:   Raw bytes of the uploaded audio file.
            filename:     Original filename (used to detect format extension).
            include_mfcc: If True, compute 13 MFCC coefficients (slower).

        Returns:
            AudioFeatures dataclass ready to be serialized.
        """
        if not _LIBROSA_OK:
            raise RuntimeError(
                "librosa is required for feature extraction. "
                "Install it with: pip install librosa"
            )

        tmpdir = tempfile.mkdtemp(prefix="audio_feat_")
        try:
            wav_path = self._convert_to_wav(file_bytes, filename, tmpdir)
            y, sr = self._load_and_normalize(wav_path)
            duration = float(len(y)) / sr

            waveform = self._extract_waveform(y, sr)
            spectrogram = self._extract_spectrogram(y, sr)
            energy = self._extract_energy(y, sr)
            mfcc = self._extract_mfcc(y, sr) if include_mfcc else None

            # New specialized acoustic features (Ported from audio-analysis branch)
            tempo_arr, _ = librosa.beat.beat_track(y=y, sr=sr)
            tempo = float(np.atleast_1d(tempo_arr)[0])
            
            centroid = librosa.feature.spectral_centroid(y=y, sr=sr, n_fft=2048, hop_length=512)
            spectral_centroid_mean = float(centroid.mean())

            return AudioFeatures(
                sample_rate=sr,
                duration=round(duration, 3),
                num_channels=1,  # always mono after conversion
                waveform=waveform,
                spectrogram=spectrogram,
                energy=energy,
                tempo=round(tempo, 2),
                spectral_centroid_mean=round(spectral_centroid_mean, 2),
                mfcc=mfcc,
            )
        finally:
            self._cleanup(tmpdir)

    # ── Step 1: Format conversion ─────────────────────────────────────────────

    def _convert_to_wav(self, file_bytes: bytes, filename: str, tmpdir: str) -> str:
        """
        Convert any supported audio format to 16 kHz mono WAV using pydub/ffmpeg.
        Falls back to writing the bytes directly if pydub is unavailable and the
        file is already a WAV.
        """
        ext = Path(filename).suffix.lower().lstrip(".")
        if not ext:
            ext = "wav"

        # Write raw bytes to a temp file first
        raw_path = os.path.join(tmpdir, f"raw_input.{ext}")
        with open(raw_path, "wb") as f:
            f.write(file_bytes)

        wav_path = os.path.join(tmpdir, "converted_16k_mono.wav")

        if _PYDUB_OK:
            try:
                audio: AudioSegment = AudioSegment.from_file(raw_path, format=ext or None)
                # Convert to mono 16 kHz
                audio = audio.set_channels(1).set_frame_rate(TARGET_SR)
                audio.export(wav_path, format="wav")
                logger.debug(
                    "pydub converted '%s' → 16kHz mono WAV (%d ms)",
                    filename, len(audio)
                )
                return wav_path
            except Exception as exc:
                logger.warning("pydub conversion failed (%s); trying librosa load directly.", exc)

        # Fallback: just use the raw path (librosa can handle many formats itself)
        return raw_path

    # ── Step 2: Load & normalize ──────────────────────────────────────────────

    def _load_and_normalize(self, wav_path: str) -> tuple[np.ndarray, int]:
        """
        Load audio with librosa (resamples to TARGET_SR, converts to mono)
        then normalize amplitude to [-1, 1].
        """
        y, sr = librosa.load(wav_path, sr=TARGET_SR, mono=True)

        # Normalize to [-1, 1] (peak normalization)
        max_amp = np.max(np.abs(y))
        if max_amp > 0:
            y = librosa.util.normalize(y)

        logger.debug("Loaded %d samples @ %d Hz (duration=%.2fs)", len(y), sr, len(y) / sr)
        return y, int(sr)

    # ── Step 3: Waveform ─────────────────────────────────────────────────────

    def _extract_waveform(self, y: np.ndarray, sr: int) -> WaveformData:
        """
        Down-sample waveform array to WAVEFORM_MAX_PTS points for JSON transfer.
        Uses chunk-max for envelope representation (peaks not lost).
        """
        n = len(y)
        chunk_size = max(1, n // WAVEFORM_MAX_PTS)
        num_pts = math.ceil(n / chunk_size)

        timestamps: list[float] = []
        amplitudes: list[float] = []

        for i in range(num_pts):
            start = i * chunk_size
            end = min(start + chunk_size, n)
            chunk = y[start:end]
            # Peak of absolute value, signed by the dominant polarity
            peak_idx = np.argmax(np.abs(chunk))
            amp = float(chunk[peak_idx])
            t = float(start + peak_idx) / sr
            timestamps.append(round(t, 4))
            amplitudes.append(round(float(amp), 5))

        return WaveformData(timestamps=timestamps, amplitudes=amplitudes)

    # ── Step 4: STFT Spectrogram ──────────────────────────────────────────────

    def _extract_spectrogram(self, y: np.ndarray, sr: int) -> SpectrogramData:
        """
        Compute STFT spectrogram, convert to dB, down-sample to
        SPEC_FREQ_BINS × SPEC_TIME_BINS for the frontend.
        """
        # Hop length chosen so we get ~SPEC_TIME_BINS frames for typical 1-5min audio
        hop_length = max(512, len(y) // (SPEC_TIME_BINS * 2))
        n_fft = 2048

        D = librosa.stft(y, n_fft=n_fft, hop_length=hop_length)
        S_db = librosa.amplitude_to_db(np.abs(D), ref=np.max)

        # Full shape: (n_fft//2 + 1, T)
        full_freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
        full_times = librosa.frames_to_time(np.arange(S_db.shape[1]), sr=sr, hop_length=hop_length)

        # Down-sample frequency axis to SPEC_FREQ_BINS (take evenly spaced rows)
        freq_indices = np.linspace(0, S_db.shape[0] - 1, SPEC_FREQ_BINS, dtype=int)
        S_freq = S_db[freq_indices, :]
        sampled_freqs = full_freqs[freq_indices]

        # Down-sample time axis to SPEC_TIME_BINS
        time_indices = np.linspace(0, S_freq.shape[1] - 1, min(SPEC_TIME_BINS, S_freq.shape[1]), dtype=int)
        S_final = S_freq[:, time_indices]
        sampled_times = full_times[time_indices]

        # Clip dB to [-80, 0] range and round for compactness
        S_clipped = np.clip(S_final, -80, 0)

        return SpectrogramData(
            time_bins=[round(float(t), 4) for t in sampled_times],
            freq_bins=[round(float(f), 2) for f in sampled_freqs],
            magnitude_db=[
                [round(float(v), 1) for v in row]
                for row in S_clipped
            ],
        )

    # ── Step 5: RMS Energy ────────────────────────────────────────────────────

    def _extract_energy(self, y: np.ndarray, sr: int) -> EnergyData:
        """
        Compute frame-level RMS energy and down-sample to ENERGY_MAX_PTS points.
        """
        hop_length = 512
        rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop_length)[0]
        times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)

        # Down-sample
        if len(rms) > ENERGY_MAX_PTS:
            indices = np.linspace(0, len(rms) - 1, ENERGY_MAX_PTS, dtype=int)
            rms = rms[indices]
            times = times[indices]

        # Normalize RMS to [0, 1]
        rms_max = float(np.max(rms)) if np.max(rms) > 0 else 1.0
        rms_norm = rms / rms_max

        return EnergyData(
            timestamps=[round(float(t), 4) for t in times],
            rms_values=[round(float(v), 5) for v in rms_norm],
        )

    # ── Step 6: MFCCs (optional) ──────────────────────────────────────────────

    def _extract_mfcc(self, y: np.ndarray, sr: int) -> MFCCData:
        """
        Compute MFCC coefficients and down-sample time axis.
        """
        hop_length = 512
        mfccs = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=MFCC_N, hop_length=hop_length)
        times = librosa.frames_to_time(np.arange(mfccs.shape[1]), sr=sr, hop_length=hop_length)

        # Down-sample time axis
        max_pts = 200
        if mfccs.shape[1] > max_pts:
            indices = np.linspace(0, mfccs.shape[1] - 1, max_pts, dtype=int)
            mfccs = mfccs[:, indices]
            times = times[indices]

        return MFCCData(
            timestamps=[round(float(t), 4) for t in times],
            coefficients=[
                [round(float(v), 3) for v in coeff_row]
                for coeff_row in mfccs
            ],
        )

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _configure_ffmpeg(self) -> None:
        """
        Resolve ffmpeg/ffprobe and configure pydub.
        Tries config path first, then PATH, then gives up gracefully.
        """
        if not _PYDUB_OK:
            return

        ffmpeg_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
        ffprobe_name = "ffprobe.exe" if os.name == "nt" else "ffprobe"

        ffmpeg_exe = self._resolve_binary(self._ffmpeg_exe, ffmpeg_name)
        ffprobe_exe = self._resolve_binary(self._ffprobe_exe, ffprobe_name)

        if ffmpeg_exe:
            AudioSegment.converter = ffmpeg_exe
            # Prepend bin directory to PATH so ffprobe is also found
            bin_dir = os.path.dirname(ffmpeg_exe)
            current_path = os.environ.get("PATH", "")
            if bin_dir not in current_path:
                os.environ["PATH"] = bin_dir + os.pathsep + current_path
            logger.debug("ffmpeg configured: %s", ffmpeg_exe)
        else:
            logger.warning(
                "ffmpeg not found in PATH or config. "
                "MP3/M4A conversion may fail. Install ffmpeg and add to PATH."
            )

    @staticmethod
    def _resolve_binary(configured: str, exe_name: str) -> Optional[str]:
        """Find a binary: check configured path first, then shutil.which."""
        if configured:
            configured = configured.strip().strip('"')
            candidate = configured
            if os.path.isdir(candidate):
                candidate = os.path.join(candidate, exe_name)
            if os.path.isfile(candidate):
                return os.path.abspath(candidate)

        found = shutil.which(exe_name)
        return os.path.abspath(found) if found else None

    @staticmethod
    def _cleanup(tmpdir: str) -> None:
        """Remove temp directory with retry logic for Windows file-lock issues."""
        for attempt in range(5):
            try:
                shutil.rmtree(tmpdir)
                return
            except PermissionError:
                time.sleep(0.15 * (attempt + 1))
        shutil.rmtree(tmpdir, ignore_errors=True)
