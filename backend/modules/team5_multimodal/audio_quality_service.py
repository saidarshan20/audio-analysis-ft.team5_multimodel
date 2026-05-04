"""
audio_quality_service.py

Deterministic, speech-aware audio quality scoring.
Scores only speech-like clips; returns structured "unscored" for silent/non-speech.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import librosa
import numpy as np
import soundfile as sf


EPS = 1e-12


@dataclass
class AudioQualityComputation:
    x: np.ndarray
    sr: int
    duration: float
    original_channels: int
    was_downmixed: bool
    duration_warning: bool
    clip_ratio: float
    rms_dbfs: float


class AudioQualityService:
    def __init__(self, config_path: str | None = None):
        if config_path:
            cfg_path = Path(config_path)
        else:
            cfg_path = Path(__file__).parent / "config" / "audio_quality_thresholds.json"
        self.cfg = json.loads(cfg_path.read_text(encoding="utf-8"))

    def score_wav(self, wav_path: str, *, input_had_multiple_channels: bool = False) -> dict[str, Any]:
        try:
            base = self._preprocess(wav_path, input_had_multiple_channels=input_had_multiple_channels)
            return self._score_preprocessed(base)
        except Exception as exc:
            return self._make_unscored_payload(
                content_type="non_speech",
                summary=f"Audio quality scoring failed: {exc}",
                duration_warning=False,
                clip_ratio=0.0,
                speech_frame_ratio=0.0,
                confidence=0.1,
            )

    def _preprocess(self, wav_path: str, *, input_had_multiple_channels: bool) -> AudioQualityComputation:
        target_sr = int(self.cfg["target_sample_rate"])
        audio, sr = sf.read(wav_path, dtype="float32", always_2d=True)
        original_channels = int(audio.shape[1])
        x = np.mean(audio, axis=1)

        if sr != target_sr:
            x = librosa.resample(x, orig_sr=sr, target_sr=target_sr, res_type="kaiser_fast")
            sr = target_sr

        # DC offset removal
        if x.size:
            x = x - float(np.mean(x))

        duration = float(len(x)) / float(sr) if sr > 0 else 0.0
        duration_warning = duration < float(self.cfg["short_clip_seconds"])

        rms = float(np.sqrt(np.mean(np.square(x))) if x.size else 0.0)
        rms_dbfs = 20.0 * math.log10(rms + EPS)

        clip_threshold = float(self.cfg["clip_amplitude_threshold"])
        clip_ratio = float(np.mean(np.abs(x) >= clip_threshold)) if x.size else 0.0

        return AudioQualityComputation(
            x=x,
            sr=sr,
            duration=duration,
            original_channels=original_channels,
            was_downmixed=bool(input_had_multiple_channels or original_channels > 1),
            duration_warning=duration_warning,
            clip_ratio=clip_ratio,
            rms_dbfs=rms_dbfs,
        )

    def _score_preprocessed(self, base: AudioQualityComputation) -> dict[str, Any]:
        if base.rms_dbfs < float(self.cfg["silence_dbfs_threshold"]):
            conf = self._confidence(
                duration_warning=base.duration_warning,
                speech_frame_ratio=0.0,
                clip_ratio=base.clip_ratio,
                was_downmixed=base.was_downmixed,
            )
            return self._make_unscored_payload(
                content_type="silent",
                summary="Silent or near-silent audio",
                duration_warning=base.duration_warning,
                clip_ratio=base.clip_ratio,
                speech_frame_ratio=0.0,
                confidence=conf,
            )

        vad = self._compute_vad(base.x, base.sr)
        speech_ratio = vad["speech_frame_ratio"]
        min_speech_ratio = float(self.cfg["vad"]["min_speech_ratio"])
        min_unvoiced_ratio = float(self.cfg["vad"].get("min_unvoiced_ratio_for_speech", 0.0))
        unvoiced_ratio = 1.0 - speech_ratio
        is_speech = (
            speech_ratio >= min_speech_ratio
            and vad["has_long_voiced_run"]
            and unvoiced_ratio >= min_unvoiced_ratio
        )

        if not is_speech:
            conf = self._confidence(
                duration_warning=base.duration_warning,
                speech_frame_ratio=speech_ratio,
                clip_ratio=base.clip_ratio,
                was_downmixed=base.was_downmixed,
            )
            return self._make_unscored_payload(
                content_type="non_speech",
                summary="Non-speech audio — quality metrics not applicable",
                duration_warning=base.duration_warning,
                clip_ratio=base.clip_ratio,
                speech_frame_ratio=speech_ratio,
                confidence=conf,
            )

        frame_energy = vad["frame_energy"]
        voiced_mask = vad["voiced_mask"]
        unvoiced_mask = ~voiced_mask

        voiced_energy = float(np.mean(frame_energy[voiced_mask])) if np.any(voiced_mask) else 0.0
        unvoiced_energy = float(np.mean(frame_energy[unvoiced_mask])) if np.any(unvoiced_mask) else 0.0
        total_energy = float(np.mean(frame_energy)) if frame_energy.size else 0.0

        snr_max = float(self.cfg["snr"]["max_db"])
        if unvoiced_energy <= EPS:
            snr_db = snr_max
        else:
            snr_db = 10.0 * math.log10(max(voiced_energy, EPS) / max(unvoiced_energy, EPS))
        snr_db = float(np.clip(snr_db, 0.0, snr_max))
        snr_score = self._piecewise_score(snr_db, self.cfg["snr"]["segments"])

        loudness_score = self._piecewise_score(base.rms_dbfs, self.cfg["loudness_dbfs_segments"])
        if base.clip_ratio > float(self.cfg["clip_ratio_cap_threshold"]):
            loudness_score = min(loudness_score, float(self.cfg["loudness_clip_cap_score"]))

        clarity_ratio = self._clarity_ratio(base.x, base.sr, voiced_mask)
        clarity_score = self._piecewise_score(clarity_ratio, self.cfg["clarity"]["segments"])

        stationary_ratio = (unvoiced_energy / max(total_energy, EPS)) if total_energy > 0 else 1.0
        stationary_score = self._piecewise_score(
            float(np.clip(stationary_ratio, 0.0, 1.0)),
            self.cfg["cleanliness"]["stationary_segments_inverse"],
        )

        transient_ratio = self._transient_ratio(vad["frame_db"], base.sr)
        transient_score = self._piecewise_score(
            float(np.clip(transient_ratio, 0.0, 1.0)),
            self.cfg["cleanliness"]["transient_segments_inverse"],
        )

        clean_cfg = self.cfg["cleanliness"]
        cleanliness_score = (
            float(clean_cfg["stationary_weight"]) * stationary_score
            + float(clean_cfg["transient_weight"]) * transient_score
        )

        w = self.cfg["overall_weights"]
        overall = (
            float(w["snr"]) * snr_score
            + float(w["loudness"]) * loudness_score
            + float(w["clarity"]) * clarity_score
            + float(w["cleanliness"]) * cleanliness_score
        )
        overall = float(np.clip(overall, 0.0, 100.0))
        rating = self._rating(overall)

        conf = self._confidence(
            duration_warning=base.duration_warning,
            speech_frame_ratio=speech_ratio,
            clip_ratio=base.clip_ratio,
            was_downmixed=base.was_downmixed,
        )

        return {
            "score_version": self.cfg["score_version"],
            "content_type": "speech",
            "is_speech_present": True,
            "duration_warning": base.duration_warning,
            "confidence": round(conf, 3),
            "overall_score": round(overall, 2),
            "composite_percent": round(overall, 2),
            "rating": rating,
            "summary": self._summary(rating),
            "snr_db": round(snr_db, 2),
            "clip_ratio": round(base.clip_ratio, 6),
            "speech_frame_ratio": round(float(speech_ratio), 6),
            "metrics": {
                "snr": round(snr_score, 2),
                "loudness": round(loudness_score, 2),
                "clarity": round(clarity_score, 2),
                "cleanliness": round(cleanliness_score, 2),
            },
        }

    def _compute_vad(self, x: np.ndarray, sr: int) -> dict[str, Any]:
        vad_cfg = self.cfg["vad"]
        frame_len = max(1, int(round(sr * (float(vad_cfg["frame_ms"]) / 1000.0))))
        hop_len = max(1, int(round(sr * (float(vad_cfg["hop_ms"]) / 1000.0))))

        frames = self._frame_signal(x, frame_len, hop_len)
        energy = np.mean(np.square(frames), axis=1)
        frame_db = 10.0 * np.log10(energy + EPS)

        noise_floor_db = float(np.percentile(frame_db, float(vad_cfg["noise_percentile"]))) if frame_db.size else -120.0
        vad_threshold_db = noise_floor_db + float(vad_cfg["threshold_db_above_noise"])
        voiced = frame_db >= vad_threshold_db

        voiced = self._remove_short_voiced_runs(voiced, int(vad_cfg["min_voiced_run_frames"]))
        voiced = self._fill_small_unvoiced_gaps(voiced, int(vad_cfg["max_fill_unvoiced_gap_frames"]))

        speech_frame_ratio = float(np.mean(voiced)) if voiced.size else 0.0
        has_long_voiced_run = self._has_min_run(voiced, int(vad_cfg["min_long_voiced_run_frames"]))
        return {
            "frame_energy": energy,
            "frame_db": frame_db,
            "voiced_mask": voiced,
            "speech_frame_ratio": speech_frame_ratio,
            "has_long_voiced_run": has_long_voiced_run,
            "frame_len": frame_len,
            "hop_len": hop_len,
        }

    @staticmethod
    def _frame_signal(x: np.ndarray, frame_len: int, hop_len: int) -> np.ndarray:
        if x.size == 0:
            return np.zeros((1, frame_len), dtype=np.float32)
        if x.size < frame_len:
            pad = np.zeros(frame_len - x.size, dtype=x.dtype)
            return np.expand_dims(np.concatenate([x, pad]), axis=0)
        n_frames = 1 + (x.size - frame_len) // hop_len
        idx = np.arange(frame_len)[None, :] + hop_len * np.arange(n_frames)[:, None]
        return x[idx]

    @staticmethod
    def _remove_short_voiced_runs(mask: np.ndarray, min_len: int) -> np.ndarray:
        if mask.size == 0:
            return mask
        out = mask.copy()
        i = 0
        n = len(out)
        while i < n:
            if out[i]:
                j = i
                while j < n and out[j]:
                    j += 1
                if (j - i) < min_len:
                    out[i:j] = False
                i = j
            else:
                i += 1
        return out

    @staticmethod
    def _fill_small_unvoiced_gaps(mask: np.ndarray, max_gap: int) -> np.ndarray:
        if mask.size == 0:
            return mask
        out = mask.copy()
        i = 0
        n = len(out)
        while i < n:
            if not out[i]:
                j = i
                while j < n and not out[j]:
                    j += 1
                if i > 0 and j < n and (j - i) <= max_gap:
                    out[i:j] = True
                i = j
            else:
                i += 1
        return out

    @staticmethod
    def _has_min_run(mask: np.ndarray, min_len: int) -> bool:
        run = 0
        for v in mask:
            run = run + 1 if v else 0
            if run >= min_len:
                return True
        return False

    def _clarity_ratio(self, x: np.ndarray, sr: int, voiced_mask: np.ndarray) -> float:
        vad_cfg = self.cfg["vad"]
        frame_len = max(1, int(round(sr * (float(vad_cfg["frame_ms"]) / 1000.0))))
        hop_len = max(1, int(round(sr * (float(vad_cfg["hop_ms"]) / 1000.0))))
        frames = self._frame_signal(x, frame_len, hop_len)
        if len(voiced_mask) != len(frames):
            n = min(len(voiced_mask), len(frames))
            voiced_mask = voiced_mask[:n]
            frames = frames[:n]
        voiced_frames = frames[voiced_mask]
        if voiced_frames.size == 0:
            return 0.0

        window = np.hanning(frame_len)
        spec = np.fft.rfft(voiced_frames * window[None, :], n=frame_len, axis=1)
        power = np.abs(spec) ** 2
        freqs = np.fft.rfftfreq(frame_len, d=1.0 / sr)

        vb0, vb1 = self.cfg["clarity"]["voice_band_hz"]
        tb0, tb1 = self.cfg["clarity"]["total_band_hz"]
        voice_idx = (freqs >= float(vb0)) & (freqs <= float(vb1))
        total_idx = (freqs >= float(tb0)) & (freqs <= float(tb1))
        e_voice = float(np.sum(power[:, voice_idx]))
        e_total = float(np.sum(power[:, total_idx]))
        return float(e_voice / (e_total + EPS))

    def _transient_ratio(self, frame_db: np.ndarray, sr: int) -> float:
        if frame_db.size == 0:
            return 0.0
        hop_ms = float(self.cfg["vad"]["hop_ms"])
        fps = 1000.0 / hop_ms
        win = max(3, int(round(float(self.cfg["cleanliness"]["transient_window_sec"]) * fps)))
        kernel = np.ones(win, dtype=np.float64) / float(win)

        mean = np.convolve(frame_db, kernel, mode="same")
        mean_sq = np.convolve(np.square(frame_db), kernel, mode="same")
        std = np.sqrt(np.maximum(mean_sq - np.square(mean), 0.0))
        sigma = float(self.cfg["cleanliness"]["transient_sigma"])
        spikes = frame_db > (mean + sigma * std)
        return float(np.mean(spikes))

    @staticmethod
    def _piecewise_score(x: float, segments: list[dict[str, float]]) -> float:
        if not segments:
            return 0.0
        x = float(x)
        first = segments[0]
        last = segments[-1]
        if x <= float(first["x0"]):
            return float(first["y0"])
        if x >= float(last["x1"]):
            return float(last["y1"])

        for s in segments:
            x0 = float(s["x0"])
            x1 = float(s["x1"])
            y0 = float(s["y0"])
            y1 = float(s["y1"])
            if x0 <= x <= x1:
                if abs(x1 - x0) <= EPS:
                    return y1
                t = (x - x0) / (x1 - x0)
                return y0 + t * (y1 - y0)
        return float(last["y1"])

    def _rating(self, score: float) -> str:
        rb = self.cfg["rating_bands"]
        if score <= float(rb["poor_max"]):
            return "Poor"
        if score <= float(rb["fair_max"]):
            return "Fair"
        if score <= float(rb["good_max"]):
            return "Good"
        return "Excellent"

    @staticmethod
    def _summary(rating: str) -> str:
        if rating == "Excellent":
            return "High-quality recording with strong speech clarity and low background noise."
        if rating == "Good":
            return "Usable speech quality with minor degradations."
        if rating == "Fair":
            return "Moderate quality; audible noise or level imbalance affects clarity."
        if rating == "Poor":
            return "Low quality; noise, clipping, or weak speech presence significantly impacts analysis."
        return "Audio quality could not be scored."

    def _confidence(
        self,
        *,
        duration_warning: bool,
        speech_frame_ratio: float,
        clip_ratio: float,
        was_downmixed: bool,
    ) -> float:
        c = 1.0
        if duration_warning:
            c -= 0.3
        deficit = max(0.0, 0.5 - float(speech_frame_ratio))
        if deficit > 0:
            c -= 0.2 * math.ceil(deficit / 0.1)
        if clip_ratio > float(self.cfg["clip_ratio_cap_threshold"]):
            c -= 0.2
        if was_downmixed:
            c -= 0.1
        return float(np.clip(c, 0.1, 1.0))

    def _make_unscored_payload(
        self,
        *,
        content_type: str,
        summary: str,
        duration_warning: bool,
        clip_ratio: float,
        speech_frame_ratio: float,
        confidence: float,
    ) -> dict[str, Any]:
        return {
            "score_version": self.cfg["score_version"],
            "content_type": content_type,
            "is_speech_present": False,
            "duration_warning": bool(duration_warning),
            "confidence": round(float(np.clip(confidence, 0.1, 1.0)), 3),
            "overall_score": None,
            "composite_percent": None,
            "rating": "unscored",
            "summary": summary,
            "snr_db": None,
            "clip_ratio": round(float(max(0.0, clip_ratio)), 6),
            "speech_frame_ratio": round(float(max(0.0, speech_frame_ratio)), 6),
            "metrics": {
                "snr": None,
                "loudness": None,
                "clarity": None,
                "cleanliness": None,
            },
        }
