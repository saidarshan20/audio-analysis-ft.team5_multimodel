"""
router.py  –  MANDATORY router for Team 1 (AutoML).
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import List
import random

router = APIRouter(prefix="/team1", tags=["Team 1 - AutoML"])


# -------- Input Schema --------
class PredictionRequest(BaseModel):
    features: List[float]


# -------- Dummy AutoML Logic --------
def simple_model(features: List[float]):
    score = sum(features) / len(features)
    if score > 0.5:
        prediction = "High"
    else:
        prediction = "Low"
    confidence = round(random.uniform(0.7, 0.95), 2)
    return prediction, confidence, score


# -------- Endpoints --------
@router.get("/health")
def health():
    return {"team": "team1_automl", "status": "ok"}


@router.post("/predict")
def predict(data: PredictionRequest):
    prediction, confidence, score = simple_model(data.features)
    return {
        "input_features": data.features,
        "prediction": prediction,
        "confidence": confidence,
        "average_score": round(score, 3),
        "automl_insight": (
            "Features indicate a strong pattern"
            if prediction == "High"
            else "Weak signal detected, consider feature engineering"
        ),
    }


@router.post("/analyze")
def analyze(data: PredictionRequest):
    features = data.features
    return {
        "count": len(features),
        "min": min(features),
        "max": max(features),
        "mean": round(sum(features) / len(features), 3),
        "insight": (
            "Data looks normalized" if max(features) <= 1 else "Scaling recommended"
        ),
    }
