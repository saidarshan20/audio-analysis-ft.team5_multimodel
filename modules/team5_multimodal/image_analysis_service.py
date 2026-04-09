"""
image_analysis_service.py  –  Groq-upgraded version for Team 5 Multimodal.

Changes from original:
  - BLIP captioning replaced with Groq Vision (llama-3.2-11b-vision-preview)
  - Smart Cluster Naming via Groq (Point 1)
  - Image Q&A via Groq Vision (Point 2)
  - Advanced Search Intelligence via Groq (Point 3)
  - YOLO, CLIP, UMAP, KMeans are unchanged (still local, still free)
"""

import base64
import io
import json
import logging
import numpy as np
from PIL import Image
from ultralytics import YOLO
from sentence_transformers import SentenceTransformer
from sklearn.cluster import KMeans
import umap
from groq import Groq

from modules.team5_multimodal.config import get_settings
from modules.team5_multimodal.models import (
    ImageAnalysisResult,
    DetectionBox,
    ProjectionPoint,
    ClusterInfo
)

logger = logging.getLogger(__name__)


def _image_to_base64(image_bytes: bytes) -> str:
    """Convert raw image bytes to a base64-encoded string for Groq Vision API."""
    return base64.b64encode(image_bytes).decode("utf-8")


class ImageAnalysisService:
    """
    Groq-powered multi-modal image analysis service.
    Uses:
      - YOLOv8              → Object detection (local, free)
      - CLIP                → Semantic embeddings (local, free)
      - UMAP                → 2D projection (local, free)
      - KMeans              → Clustering (local, free)
      - Groq Vision         → Captioning & Q&A (replaces BLIP)
      - Groq Text           → Cluster naming & Search
    """

    _yolo_model = None
    _embed_model = None
    _groq_client = None

    def __init__(self):
        self.settings = get_settings()
        self._load_models()

    def _load_models(self):
        """Lazy load local models and Groq client."""
        if ImageAnalysisService._yolo_model is None:
            logger.info("Loading YOLOv8 model from %s...", self.settings.yolo_model)
            ImageAnalysisService._yolo_model = YOLO(self.settings.yolo_model)

        if ImageAnalysisService._embed_model is None:
            logger.info("Loading CLIP embedding model from %s...", self.settings.embedding_model)
            ImageAnalysisService._embed_model = SentenceTransformer(self.settings.embedding_model)

        if ImageAnalysisService._groq_client is None:
            logger.info("Initializing Groq client...")
            ImageAnalysisService._groq_client = Groq(api_key=self.settings.groq_api_key)

    # ─────────────────── Captioning (replaces BLIP) ───────────────────

    def _get_groq_caption(self, image_bytes: bytes) -> str:
        """Use Groq Vision to generate a detailed caption. Replaces BLIP."""
        try:
            b64 = _image_to_base64(image_bytes)
            response = ImageAnalysisService._groq_client.chat.completions.create(
                model=self.settings.groq_vision_model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": (
                                    "Describe this image in one clear, detailed sentence. "
                                    "Focus on the main subject, setting, and notable objects."
                                )
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{b64}"
                                }
                            }
                        ]
                    }
                ],
                max_tokens=150,
                temperature=0.3
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.warning("Groq captioning failed: %s", e)
            return "Image description unavailable."

    # ─────────────────── Core Analysis ───────────────────

    def analyze_image(self, image_bytes: bytes, filename: str) -> tuple[ImageAnalysisResult, np.ndarray]:
        """Perform detection, captioning (via Groq), and CLIP embedding."""
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # 1. YOLO Detection — stricter confidence and IOU thresholds
        results = ImageAnalysisService._yolo_model(img, verbose=False, iou=0.3, conf=0.4)[0]
        detections = []
        for box in results.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            label = results.names[int(box.cls[0])]
            detections.append(DetectionBox(label=label, confidence=conf, box=[x1, y1, x2, y2]))

        # 2. Groq Vision Captioning — replaces BLIP
        caption = self._get_groq_caption(image_bytes)

        # 3. CLIP Embedding — unchanged
        embedding = ImageAnalysisService._embed_model.encode(img)

        result = ImageAnalysisResult(filename=filename, caption=caption, detections=detections)
        return result, embedding

    # ─────────────────── Point 1: Smart Cluster Naming ───────────────────

    def name_clusters(self, cluster_labels: np.ndarray, results: list[ImageAnalysisResult], n_clusters: int) -> list[ClusterInfo]:
        """Use Groq to generate smart cluster names from sample captions."""
        cluster_info_list = []

        for c_id in range(n_clusters):
            member_indices = [i for i, lbl in enumerate(cluster_labels) if lbl == c_id]
            count = len(member_indices)
            sample_captions = [results[i].caption for i in member_indices[:5]]
            captions_text = "\n".join(f"- {c}" for c in sample_captions)

            try:
                response = ImageAnalysisService._groq_client.chat.completions.create(
                    model=self.settings.groq_model,
                    messages=[
                        {"role": "system", "content": "You are an expert at categorizing and naming groups of images."},
                        {"role": "user", "content": (
                            f"Here are descriptions of {count} images grouped together:\n{captions_text}\n\n"
                            "Give this group a SHORT, specific name (2-4 words max). Return ONLY the name."
                        )}
                    ],
                    max_tokens=20,
                    temperature=0.5
                )
                smart_name = response.choices[0].message.content.strip().strip('"\'')
            except Exception as e:
                logger.warning("Groq cluster naming failed for cluster %d: %s", c_id, e)
                smart_name = f"Group {c_id + 1}"

            cluster_info_list.append(ClusterInfo(cluster_id=c_id, description=smart_name, count=count))

        return cluster_info_list

    # ─────────────────── Clustering ───────────────────

    def perform_clustering(self, embeddings: list[np.ndarray], filenames: list[str], results: list[ImageAnalysisResult] | None = None) -> tuple[list[ProjectionPoint], list[ClusterInfo]]:
        """Run UMAP + KMeans. If results provided, uses Groq for smart naming."""
        if not embeddings:
            return [], []

        data = np.array(embeddings)
        n_samples = len(data)

        # Dimensionality Reduction (UMAP)
        if n_samples > 1:
            n_neighbors = min(n_samples - 1, 15)
            reducer = umap.UMAP(n_neighbors=n_neighbors, min_dist=0.1, n_components=2, random_state=42, init='random')
            projection = reducer.fit_transform(data)
        else:
            projection = np.array([[0.0, 0.0]])

        # 2. KMeans Clustering - Smart K-Estimation via Silhouette Score
        if n_samples <= 1:
            n_clusters = 1
            cluster_labels = np.zeros(n_samples, dtype=int)
        else:
            from sklearn.metrics import silhouette_score
            best_k = 2
            best_score = -1
            
            # Test different K values from 2 to 8 (or N-1)
            limit = min(8, n_samples - 1) 
            for k in range(2, limit + 1):
                km = KMeans(n_clusters=k, random_state=42, n_init="auto")
                l = km.fit_predict(data)
                score = silhouette_score(data, l)
                if score > best_score:
                    best_score = score
                    best_k = k
            
            n_clusters = best_k
            kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init='auto')
            cluster_labels = kmeans.fit_predict(data)

        # ProjectionPoints — unchanged
        points = [ProjectionPoint(x=float(projection[i, 0]), y=float(projection[i, 1]), cluster=int(cluster_labels[i]), filename=filenames[i]) for i in range(n_samples)]

        # Smart Cluster Naming (Point 1)
        if results:
            clusters = self.name_clusters(cluster_labels, results, n_clusters)
        else:
            clusters = [ClusterInfo(cluster_id=c_id, description=f"Group {c_id + 1}", count=int(np.sum(cluster_labels == c_id))) for c_id in range(n_clusters)]

        return points, clusters

    # ─────────────────── Point 2: Contextual Image Q&A ───────────────────

    def ask_about_image(self, image_bytes: bytes, question: str) -> str:
        """Send an image + question to Groq Vision. Returns intelligent answer."""
        try:
            b64 = _image_to_base64(image_bytes)
            response = ImageAnalysisService._groq_client.chat.completions.create(
                model=self.settings.groq_vision_model,
                messages=[
                    {"role": "system", "content": "You are an expert image analyst. Answer questions about images clearly and concisely."},
                    {"role": "user", "content": [
                        {"type": "text", "text": question},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}
                    ]}
                ],
                max_tokens=300,
                temperature=0.2
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error("Groq image Q&A failed: %s", e)
            raise RuntimeError(f"Failed to get answer: {str(e)}")

    # ─────────────────── Point 3: Advanced Search ───────────────────

    def search_images(self, query: str, captions: list[dict]) -> list[dict]:
        """Advanced search using Groq. Ranks images by relevance to query."""
        if not captions:
            return []

        captions_text = "\n".join(f"{i+1}. [{c['filename']}]: {c['caption']}" for i, c in enumerate(captions))

        try:
            response = ImageAnalysisService._groq_client.chat.completions.create(
                model=self.settings.groq_model,
                messages=[
                    {"role": "system", "content": (
                        "You are an intelligent image search engine. "
                        "Rank the provided image descriptions by how well they match the user's search query. "
                        'Return ONLY a valid JSON array: [{"filename": "name.jpg", "relevance_score": 9, "reason": "why"}]. '
                        "Score 1-10 (10 = perfect match). ONLY include images with score >= 3."
                    )},
                    {"role": "user", "content": f"Search Query: \"{query}\"\n\nImage Descriptions:\n{captions_text}\n\nReturn the ranked JSON array."}
                ],
                max_tokens=800,
                temperature=0.1
            )

            content = response.choices[0].message.content.strip()
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()

            ranked = json.loads(content)
            caption_map = {c['filename']: c['caption'] for c in captions}
            for item in ranked:
                item['caption'] = caption_map.get(item['filename'], '')
            ranked.sort(key=lambda x: x.get('relevance_score', 0), reverse=True)
            return ranked
        except Exception as e:
            logger.error("Groq search failed: %s", e)
            return [{"filename": c['filename'], "caption": c['caption'], "relevance_score": 5, "reason": "Search unavailable"} for c in captions]
