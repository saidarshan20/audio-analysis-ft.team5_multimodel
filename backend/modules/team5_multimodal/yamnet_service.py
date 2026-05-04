from __future__ import annotations

import csv
import json
import logging
import threading
from collections import defaultdict
from pathlib import Path
from typing import Any

import librosa
import numpy as np

from modules.team5_multimodal.config import Team5Settings

logger = logging.getLogger(__name__)

try:
    import tensorflow as tf
    import tensorflow_hub as hub

    _TF_AVAILABLE = True
except Exception:
    tf = None  # type: ignore[assignment]
    hub = None  # type: ignore[assignment]
    _TF_AVAILABLE = False


class YamnetNoiseService:
    _model = None
    _class_names: list[str] = []
    _model_lock = threading.Lock()

    def __init__(self, settings: Team5Settings):
        self.settings = settings
        self.enabled = bool(settings.yamnet_enabled)
        self.frame_hop_seconds = max(float(settings.yamnet_frame_hop_seconds), 0.1)
        self.chunk_seconds = max(float(settings.yamnet_chunk_seconds), 5.0)
        self._cfg = self._load_noise_config(settings)
        self.conf_threshold = float(
            settings.yamnet_confidence_threshold or self._cfg.get("default_confidence_threshold", 0.2)
        )
        self.max_penalty_points = float(
            settings.yamnet_max_penalty_points or self._cfg.get("max_penalty_points", 25.0)
        )

    def analyze_wav(self, wav_path: str) -> dict[str, Any] | None:
        if not self.enabled:
            return None
        if not _TF_AVAILABLE:
            logger.warning("YAMNet disabled: tensorflow/tensorflow_hub is not installed.")
            return None

        model, class_names = self._ensure_model()
        if model is None:
            return None

        try:
            y, _ = librosa.load(wav_path, sr=16000, mono=True)
        except Exception as exc:
            logger.warning("YAMNet audio load failed: %s", exc)
            return None

        if y.size == 0:
            return self._empty_result()

        all_hits: list[dict[str, Any]] = []
        total_frames = 0
        chunk_samples = int(self.chunk_seconds * 16000)

        for start in range(0, len(y), chunk_samples):
            chunk = y[start : start + chunk_samples]
            if chunk.size < 1600:
                continue
            tensor = tf.convert_to_tensor(chunk, dtype=tf.float32)
            scores, _, _ = model(tensor)
            scores_np = np.array(scores)
            if scores_np.ndim != 2 or scores_np.shape[0] == 0:
                continue

            total_frames += int(scores_np.shape[0])
            offset_sec = start / 16000.0
            for frame_idx, row in enumerate(scores_np):
                class_idx = int(np.argmax(row))
                confidence = float(row[class_idx])
                if confidence < self.conf_threshold:
                    continue

                label = class_names[class_idx] if class_idx < len(class_names) else f"class_{class_idx}"
                category, penalty_weight = self._categorize_label(label)
                frame_start = offset_sec + (frame_idx * self.frame_hop_seconds)
                frame_end = frame_start + self.frame_hop_seconds
                all_hits.append(
                    {
                        "label": label,
                        "confidence": confidence,
                        "category": category,
                        "penalty_weight": penalty_weight,
                        "start": frame_start,
                        "end": frame_end,
                    }
                )

        if not all_hits:
            return self._empty_result()

        grouped: dict[str, dict[str, float | str]] = defaultdict(
            lambda: {
                "confidence_sum": 0.0,
                "count": 0.0,
                "penalty_weight": 0.0,
                "category": "",
            }
        )
        for hit in all_hits:
            g = grouped[hit["label"]]
            g["confidence_sum"] = float(g["confidence_sum"]) + float(hit["confidence"])
            g["count"] = float(g["count"]) + 1.0
            g["penalty_weight"] = float(hit["penalty_weight"])
            g["category"] = str(hit["category"])

        denom = max(total_frames, 1)
        top_classes: list[dict[str, Any]] = []
        instruments: list[dict[str, Any]] = []
        for label, stats in grouped.items():
            confidence_avg = float(stats["confidence_sum"]) / float(stats["count"])
            time_share = float(stats["count"]) / float(denom)
            item = {
                "label": label,
                "confidence": round(confidence_avg, 4),
                "time_share": round(time_share, 4),
                "category": str(stats["category"]),
                "penalty_weight": round(float(stats["penalty_weight"]), 4),
            }
            top_classes.append(item)
            if item["category"] == "instrument":
                instruments.append(item)

        top_classes.sort(
            key=lambda x: x["confidence"] * x["time_share"] * max(x["penalty_weight"], 0.1),
            reverse=True,
        )
        instruments.sort(key=lambda x: x["confidence"] * x["time_share"], reverse=True)
        timeline = self.merge_timeline_hits(all_hits, max_gap=max(self.frame_hop_seconds * 1.5, 0.4))
        severity, penalty = self.compute_penalty(top_classes, self.max_penalty_points)
        dominant_causes = [item["label"] for item in top_classes[:3]]

        return {
            "top_background_classes": top_classes[:10],
            "detected_instruments": instruments[:8],
            "noise_events_timeline": timeline[:40],
            "dominant_causes": dominant_causes,
            "noise_severity_score": round(severity, 2),
            "noise_penalty_points": round(penalty, 2),
        }

    @staticmethod
    def compute_penalty(top_classes: list[dict[str, Any]], max_penalty_points: float) -> tuple[float, float]:
        if not top_classes:
            return 0.0, 0.0

        raw_severity = 0.0
        for item in top_classes:
            raw_severity += (
                float(item.get("confidence", 0.0))
                * float(item.get("time_share", 0.0))
                * float(item.get("penalty_weight", 0.0))
            )
        severity_score = float(np.clip(raw_severity * 100.0, 0.0, 100.0))
        penalty = float(np.clip((severity_score / 100.0) * max_penalty_points, 0.0, max_penalty_points))
        return severity_score, penalty

    @staticmethod
    def merge_timeline_hits(hits: list[dict[str, Any]], max_gap: float = 0.5) -> list[dict[str, Any]]:
        if not hits:
            return []

        ordered = sorted(hits, key=lambda h: (float(h["start"]), str(h["label"])))
        merged: list[dict[str, Any]] = []
        for hit in ordered:
            if not merged:
                merged.append(
                    {
                        "label": hit["label"],
                        "start": round(float(hit["start"]), 3),
                        "end": round(float(hit["end"]), 3),
                        "confidence": float(hit["confidence"]),
                        "category": hit.get("category", ""),
                        "_count": 1.0,
                    }
                )
                continue

            last = merged[-1]
            same_label = last["label"] == hit["label"]
            close_enough = float(hit["start"]) <= float(last["end"]) + max_gap
            if same_label and close_enough:
                last["end"] = round(max(float(last["end"]), float(hit["end"])), 3)
                last["confidence"] = float(last["confidence"]) + float(hit["confidence"])
                last["_count"] = float(last["_count"]) + 1.0
            else:
                merged.append(
                    {
                        "label": hit["label"],
                        "start": round(float(hit["start"]), 3),
                        "end": round(float(hit["end"]), 3),
                        "confidence": float(hit["confidence"]),
                        "category": hit.get("category", ""),
                        "_count": 1.0,
                    }
                )

        for event in merged:
            cnt = max(float(event.pop("_count", 1.0)), 1.0)
            event["confidence"] = round(float(event["confidence"]) / cnt, 4)
        return merged

    def _categorize_label(self, label: str) -> tuple[str, float]:
        l = (label or "").strip().lower()
        aliases: dict[str, list[str]] = self._cfg.get("aliases", {})
        weights: dict[str, float] = self._cfg.get("weights", {})

        for category, words in aliases.items():
            if any(word in l for word in words):
                return category, float(weights.get(category, weights.get("other_noise", 0.45)))
        return "other_noise", float(weights.get("other_noise", 0.45))

    def _ensure_model(self):
        if YamnetNoiseService._model is not None:
            return YamnetNoiseService._model, YamnetNoiseService._class_names

        with YamnetNoiseService._model_lock:
            if YamnetNoiseService._model is not None:
                return YamnetNoiseService._model, YamnetNoiseService._class_names

            try:
                YamnetNoiseService._model = hub.load(self.settings.yamnet_model_url)
                YamnetNoiseService._class_names = self._load_class_names(YamnetNoiseService._model)
                logger.info(
                    "YAMNet loaded from %s (classes=%d)",
                    self.settings.yamnet_model_url,
                    len(YamnetNoiseService._class_names),
                )
            except Exception as exc:
                logger.warning("Failed to load YAMNet model: %s", exc)
                YamnetNoiseService._model = None
                YamnetNoiseService._class_names = []

        return YamnetNoiseService._model, YamnetNoiseService._class_names

    def _load_class_names(self, model) -> list[str]:
        class_map_path = None
        try:
            if hasattr(model, "class_map_path"):
                path_obj = model.class_map_path
                if callable(path_obj):
                    path_obj = path_obj()
                if hasattr(path_obj, "numpy"):
                    path_obj = path_obj.numpy()
                if isinstance(path_obj, bytes):
                    class_map_path = path_obj.decode("utf-8")
                else:
                    class_map_path = str(path_obj)
        except Exception:
            class_map_path = None

        if not class_map_path or not Path(class_map_path).exists():
            logger.warning("YAMNet class map path unavailable; using generic class labels.")
            return [f"class_{i}" for i in range(521)]

        names: list[str] = []
        with open(class_map_path, "r", encoding="utf-8") as fp:
            reader = csv.DictReader(fp)
            for row in reader:
                names.append(row.get("display_name", "").strip() or f"class_{len(names)}")

        if not names:
            return [f"class_{i}" for i in range(521)]
        return names

    def _load_noise_config(self, settings: Team5Settings) -> dict[str, Any]:
        if settings.yamnet_noise_config_path:
            path = Path(settings.yamnet_noise_config_path)
        else:
            path = Path(__file__).parent / "config" / "yamnet_noise_config.json"

        cfg: dict[str, Any] = {
            "default_confidence_threshold": 0.2,
            "max_penalty_points": 25.0,
            "weights": {"other_noise": 0.45},
            "aliases": {},
        }
        try:
            if path.exists():
                cfg.update(json.loads(path.read_text(encoding="utf-8")))
        except Exception as exc:
            logger.warning("Failed to read YAMNet noise config at %s: %s", path, exc)

        if settings.yamnet_penalty_weights_json.strip():
            try:
                weights_override = json.loads(settings.yamnet_penalty_weights_json)
                if isinstance(weights_override, dict):
                    cfg.setdefault("weights", {}).update(weights_override)
            except Exception as exc:
                logger.warning("Invalid YAMNet penalty weights JSON override: %s", exc)
        return cfg

    @staticmethod
    def _empty_result() -> dict[str, Any]:
        return {
            "top_background_classes": [],
            "detected_instruments": [],
            "noise_events_timeline": [],
            "dominant_causes": [],
            "noise_severity_score": 0.0,
            "noise_penalty_points": 0.0,
        }
