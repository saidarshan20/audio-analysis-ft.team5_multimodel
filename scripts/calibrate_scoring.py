"""
calibrate_scoring.py

Recomputes audio-quality threshold config from a labeled fixture set.
Output JSON can be loaded by AudioQualityService without code changes.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from statistics import median

from modules.team5_multimodal.audio_quality_service import AudioQualityService


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Calibrate audio-quality thresholds from labeled fixtures.")
    parser.add_argument(
        "--fixtures-dir",
        default="tests/fixtures/audio_quality",
        help="Directory containing audio files referenced in labels CSV.",
    )
    parser.add_argument(
        "--labels",
        default="tests/fixtures/audio_quality/labels.csv",
        help="CSV file with columns: file,tier",
    )
    parser.add_argument(
        "--base-config",
        default="modules/team5_multimodal/config/audio_quality_thresholds.json",
        help="Base threshold config path.",
    )
    parser.add_argument(
        "--out",
        default="modules/team5_multimodal/config/audio_quality_thresholds.calibrated.json",
        help="Output calibrated config path.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    fixtures_dir = Path(args.fixtures_dir)
    labels_path = Path(args.labels)
    base_cfg_path = Path(args.base_config)
    out_path = Path(args.out)

    if not labels_path.exists():
        raise FileNotFoundError(f"Labels file not found: {labels_path}")
    if not base_cfg_path.exists():
        raise FileNotFoundError(f"Base config not found: {base_cfg_path}")

    svc = AudioQualityService(str(base_cfg_path))
    rows: list[tuple[str, str]] = []
    with labels_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            file_name = (r.get("file") or "").strip()
            tier = (r.get("tier") or "").strip().capitalize()
            if file_name and tier:
                rows.append((file_name, tier))

    if not rows:
        raise ValueError("No rows found in labels CSV. Expected columns: file,tier")

    tier_scores: dict[str, list[float]] = {"Poor": [], "Fair": [], "Good": [], "Excellent": []}
    for file_name, tier in rows:
        p = fixtures_dir / file_name
        if not p.exists():
            continue
        q = svc.score_wav(str(p), input_had_multiple_channels=False)
        score = q.get("overall_score")
        if isinstance(score, (int, float)) and tier in tier_scores:
            tier_scores[tier].append(float(score))

    # Build calibrated rating boundaries using medians between adjacent tier medians.
    # If a tier is missing, fallback to base config defaults.
    cfg = json.loads(base_cfg_path.read_text(encoding="utf-8"))
    rb = cfg.get("rating_bands", {"poor_max": 39.0, "fair_max": 59.0, "good_max": 79.0})

    med = {k: (median(v) if v else None) for k, v in tier_scores.items()}
    if all(med[k] is not None for k in ("Poor", "Fair", "Good", "Excellent")):
        poor_max = (med["Poor"] + med["Fair"]) / 2.0
        fair_max = (med["Fair"] + med["Good"]) / 2.0
        good_max = (med["Good"] + med["Excellent"]) / 2.0
        rb = {
            "poor_max": round(float(poor_max), 2),
            "fair_max": round(float(fair_max), 2),
            "good_max": round(float(good_max), 2),
        }

    cfg["rating_bands"] = rb
    cfg["calibration"] = {
        "rows_used": len(rows),
        "tier_counts": {k: len(v) for k, v in tier_scores.items()},
        "tier_medians": {k: (round(v, 2) if v is not None else None) for k, v in med.items()},
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    print(f"Wrote calibrated config to: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
