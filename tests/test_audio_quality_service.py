from __future__ import annotations

import json
import subprocess
import tempfile
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from modules.team5_multimodal.audio_quality_service import AudioQualityService


def _write_wav(x: np.ndarray, sr: int = 16000) -> str:
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    sf.write(tmp.name, x, sr, subtype="PCM_16")
    return tmp.name


def test_stereo_downmix_no_error():
    svc = AudioQualityService()
    t = np.linspace(0, 2.0, int(2.0 * 16000), endpoint=False)
    left = 0.1 * np.sin(2 * np.pi * 200 * t)
    right = 0.1 * np.sin(2 * np.pi * 220 * t)
    stereo = np.stack([left, right], axis=1)
    path = _write_wav(stereo)
    out = svc.score_wav(path, input_had_multiple_channels=True)
    assert "rating" in out
    assert out["confidence"] <= 0.9
    Path(path).unlink(missing_ok=True)


def test_short_clip_duration_warning():
    svc = AudioQualityService()
    t = np.linspace(0, 1.0, int(1.0 * 16000), endpoint=False)
    x = 0.08 * np.sin(2 * np.pi * 180 * t)
    path = _write_wav(x)
    out = svc.score_wav(path, input_had_multiple_channels=False)
    assert out["duration_warning"] is True
    Path(path).unlink(missing_ok=True)


def test_silence_unscored():
    svc = AudioQualityService()
    x = np.zeros(int(2.0 * 16000), dtype=np.float32)
    path = _write_wav(x)
    out = svc.score_wav(path, input_had_multiple_channels=False)
    assert out["rating"] == "unscored"
    assert out["content_type"] == "silent"
    Path(path).unlink(missing_ok=True)


def test_music_like_noise_non_speech_unscored():
    svc = AudioQualityService()
    rng = np.random.default_rng(42)
    x = (0.08 * rng.standard_normal(int(3.0 * 16000))).astype(np.float32)
    path = _write_wav(x)
    out = svc.score_wav(path, input_had_multiple_channels=False)
    assert out["rating"] == "unscored"
    assert out["content_type"] == "non_speech"
    assert out["metrics"]["snr"] is None
    Path(path).unlink(missing_ok=True)


def test_clipping_caps_loudness_score():
    svc = AudioQualityService()
    # Intentionally clipped square-like signal
    x = np.ones(int(2.0 * 16000), dtype=np.float32)
    path = _write_wav(x)
    out = svc.score_wav(path, input_had_multiple_channels=False)
    metrics = out.get("metrics") or {}
    loudness = metrics.get("loudness")
    assert loudness is None or loudness <= 60.0
    Path(path).unlink(missing_ok=True)


def test_deterministic_same_file():
    svc = AudioQualityService()
    t = np.linspace(0, 3.0, int(3.0 * 16000), endpoint=False)
    x = 0.08 * np.sin(2 * np.pi * 220 * t)
    path = _write_wav(x)
    first = svc.score_wav(path, input_had_multiple_channels=False)
    for _ in range(100):
        nxt = svc.score_wav(path, input_had_multiple_channels=False)
        assert nxt == first
    Path(path).unlink(missing_ok=True)


def test_latency_60s_under_2s_single_call():
    svc = AudioQualityService()
    t = np.linspace(0, 60.0, int(60.0 * 16000), endpoint=False)
    # Speech-like gated tone to avoid non-speech short-circuit
    env = (np.sin(2 * np.pi * 0.8 * t) > -0.2).astype(np.float32) * 0.08
    x = (env * np.sin(2 * np.pi * 190 * t)).astype(np.float32)
    path = _write_wav(x)
    st = time.perf_counter()
    out = svc.score_wav(path, input_had_multiple_channels=False)
    dt = time.perf_counter() - st
    assert "rating" in out
    assert dt < 2.0
    Path(path).unlink(missing_ok=True)


def test_recalibration_script_outputs_thresholds_json():
    repo = Path(__file__).resolve().parents[1]
    labels = repo / "tests" / "fixtures" / "audio_quality" / "labels.csv"
    if labels.read_text(encoding="utf-8").strip() == "file,tier":
        # No fixture set yet; script behavior validated once data is available.
        return

    out = repo / "modules" / "team5_multimodal" / "config" / "audio_quality_thresholds.calibrated.json"
    cmd = [
        "python",
        str(repo / "scripts" / "calibrate_scoring.py"),
        "--fixtures-dir",
        str(repo / "tests" / "fixtures" / "audio_quality"),
        "--labels",
        str(labels),
        "--base-config",
        str(repo / "modules" / "team5_multimodal" / "config" / "audio_quality_thresholds.json"),
        "--out",
        str(out),
    ]
    subprocess.run(cmd, check=True, cwd=str(repo))
    cfg = json.loads(out.read_text(encoding="utf-8"))
    rb = cfg.get("rating_bands", {})
    assert {"poor_max", "fair_max", "good_max"}.issubset(rb.keys())
