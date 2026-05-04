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
from collections import Counter
import numpy as np
from PIL import Image
from ultralytics import YOLO
from sklearn.cluster import KMeans
import umap
from groq import Groq

from modules.team5_multimodal.config import get_settings, get_sync_llm_client, get_sync_vision_client
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
            try:
                from sentence_transformers import SentenceTransformer
            except Exception as exc:
                raise RuntimeError(
                    "Image embedding model could not be loaded. "
                    "Install compatible sentence-transformers/torch/torchcodec + FFmpeg runtime, "
                    "or disable Team5 image embedding features."
                ) from exc

            ImageAnalysisService._embed_model = SentenceTransformer(self.settings.embedding_model)

        if ImageAnalysisService._groq_client is None:
            logger.info("Initializing Sync LLM clients...")
            # General purpose text client
            t_client, t_model = get_sync_llm_client()
            ImageAnalysisService._groq_client = t_client
            ImageAnalysisService._model_name = t_model
            
            # Specialized vision client
            v_client, v_model = get_sync_vision_client()
            ImageAnalysisService._vision_client = v_client
            ImageAnalysisService._vision_model = v_model

    # ─────────────────── Captioning (replaces BLIP) ───────────────────

    def _get_groq_caption(self, image_bytes: bytes) -> str:
        """Use specialized Vision LLM to generate a detailed caption. Replaces BLIP."""
        try:
            b64 = _image_to_base64(image_bytes)
            response = ImageAnalysisService._vision_client.chat.completions.create(
                model=ImageAnalysisService._vision_model,
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
                    model=ImageAnalysisService._model_name,
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
        # UMAP requires n_neighbors >= 2 AND n_neighbors < n_samples,
        # so we need at least 3 samples for a valid reduction.
        if n_samples >= 3:
            n_neighbors = min(n_samples - 1, 15)
            reducer = umap.UMAP(n_neighbors=n_neighbors, min_dist=0.1, n_components=2, random_state=42, init='random')
            projection = reducer.fit_transform(data)
        elif n_samples == 2:
            # Trivial 2-point layout: spread along x-axis
            projection = np.array([[0.0, 0.0], [1.0, 0.0]])
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
        """Send an image + question to specialized Vision LLM. Returns intelligent answer."""
        try:
            b64 = _image_to_base64(image_bytes)
            response = ImageAnalysisService._vision_client.chat.completions.create(
                model=ImageAnalysisService._vision_model,
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

    # ─────────────────── Collection-Level Reasoning ───────────────────

    def ask_about_collection(self, question: str, images: list[dict]) -> dict:
        """Answer questions about a batch of images using captions, objects, and cluster context."""
        if not images:
            return {
                "answer": "No analyzed images were provided.",
                "supporting_results": [],
                "follow_up_suggestions": [],
            }

        dataset_lines = []
        for idx, image in enumerate(images, start=1):
            objects = ", ".join(image.get("objects", [])[:8]) or "none"
            cluster_desc = image.get("cluster_description") or image.get("cluster") or "Unknown cluster"
            caption = image.get("caption") or "No caption"
            dataset_lines.append(
                f"{idx}. {image['filename']} | Cluster: {cluster_desc} | Objects: {objects} | Caption: {caption}"
            )

        try:
            response = ImageAnalysisService._groq_client.chat.completions.create(
                model=ImageAnalysisService._model_name,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You analyze collections of images using metadata only. "
                            "Answer the user's question using the provided captions, detected objects, and cluster labels. "
                            "Return ONLY valid JSON with this schema: "
                            "{\"answer\":\"...\","
                            "\"supporting_results\":[{\"filename\":\"...\",\"reason\":\"...\"}],"
                            "\"follow_up_suggestions\":[\"...\",\"...\"]}. "
                            "Use at most 5 supporting_results and at most 3 follow_up_suggestions."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Question: {question}\n\n"
                            f"Image collection:\n" + "\n".join(dataset_lines)
                        ),
                    },
                ],
                response_format={"type": "json_object"},
                max_tokens=900,
                temperature=0.2,
            )
            return json.loads(response.choices[0].message.content.strip())
        except Exception as e:
            logger.error("Groq collection Q&A failed: %s", e)

        object_counts = Counter()
        cluster_counts = Counter()
        for image in images:
            object_counts.update(image.get("objects", []))
            cluster_counts.update([image.get("cluster_description") or image.get("cluster") or "Unknown cluster"])

        dominant_cluster = cluster_counts.most_common(1)[0][0] if cluster_counts else "Unknown cluster"
        top_objects = ", ".join(label for label, _ in object_counts.most_common(3)) or "no standout objects"
        return {
            "answer": (
                f"I couldn't run the full collection reasoning model, but this batch appears centered on "
                f"{dominant_cluster} scenes with frequent objects like {top_objects}."
            ),
            "supporting_results": [
                {"filename": image["filename"], "reason": image.get("caption", "Included as collection evidence.")}
                for image in images[:3]
            ],
            "follow_up_suggestions": [
                "Which cluster should I inspect first?",
                "Which images are the strongest matches?",
            ],
        }

    # ─────────────────── Point 3: Advanced Search ───────────────────

    def search_images(self, query: str, images: list[dict]) -> list[dict]:
        """Advanced grounded search using captions, objects, and cluster themes."""
        if not images:
            return []

        image_lines = []
        for i, image in enumerate(images, start=1):
            objects = ", ".join(image.get("objects", [])[:10]) or "none"
            cluster_desc = image.get("cluster_description") or image.get("cluster") or "Unknown cluster"
            caption = image.get("caption") or "No caption"
            image_lines.append(
                f"{i}. [{image['filename']}] | Cluster: {cluster_desc} | Objects: {objects} | Caption: {caption}"
            )

        try:
            response = ImageAnalysisService._groq_client.chat.completions.create(
                model=ImageAnalysisService._model_name,
                messages=[
                    {"role": "system", "content": (
                        "You are an intelligent grounded image search engine. "
                        "The user might search in English or other languages. "
                        "Rank results using ALL available evidence: captions, detected objects, and cluster themes. "
                        "You MUST return a valid JSON object with a 'results' key. "
                        "Schema: {\"results\": [{\"filename\": \"...\", \"relevance_score\": 1-10, "
                        "\"reason\": \"...\", \"matched_on\": [\"caption\", \"objects\", \"cluster\"]}]}. "
                        "Score 1-10 (10 = perfect match). ONLY include images with score >= 3."
                    )},
                    {"role": "user", "content": f"Search Query: \"{query}\"\n\nImage Records:\n" + "\n".join(image_lines)}
                ],
                response_format={"type": "json_object"},
                max_tokens=1000,
                temperature=0.1
            )

            content = response.choices[0].message.content.strip()
            try:
                data = json.loads(content)
                ranked = data.get("results", [])
            except json.JSONDecodeError as je:
                logger.error("JSON Search Decode Error. Raw content: %s", content)
                raise je

            image_map = {image['filename']: image for image in images}
            for item in ranked:
                source = image_map.get(item['filename'], {})
                item['caption'] = source.get('caption', '')
                item['matched_on'] = item.get('matched_on', [])

            ranked.sort(key=lambda x: x.get('relevance_score', 0), reverse=True)
            return ranked
        except Exception as e:
            logger.error("Groq search failed: %s", e)
            return [
                {
                    "filename": image['filename'],
                    "caption": image.get('caption', ''),
                    "relevance_score": 5,
                    "reason": "Search unavailable",
                    "matched_on": [],
                }
                for image in images
            ]

    # ─────────────────── Side-by-Side Comparison ───────────────────

    def compare_images(self, query: str, images: list[dict]) -> dict:
        """
        Grounded Side-by-Side Comparison:
        Analyzes two selected images to find similarities, differences, and unique patterns.
        """
        if len(images) < 2:
            return {"answer": "Please select exactly two images for comparison."}

        image_data = []
        for i, img in enumerate(images[:2]):
            objects = ", ".join(img.get("objects", [])[:10]) or "none"
            cluster = img.get("cluster_description") or img.get("cluster") or "Unknown"
            caption = img.get("caption") or "No caption"
            image_data.append(
                f"Image {i+1} [{img['filename']}]:\n"
                f"- Category: {cluster}\n"
                f"- Key Objects: {objects}\n"
                f"- Summary: {caption}"
            )

        try:
            prompt = (
                "You are an expert visual forensic analyst. Compare the two images described below "
                "based on their categories, detected objects, and AI-generated summaries. "
                "Structure your response as follows:\n"
                "1. shared_themes: Key visual themes and objects common to both images.\n"
                "2. unique_to_img1: What stands out exclusively in Image 1 (objects, setting, mood).\n"
                "3. unique_to_img2: What stands out exclusively in Image 2 (objects, setting, mood).\n"
                "4. narrative: A rich, detailed Deep Intelligence analysis comparing the two images. "
                "This MUST be at least 60 words and cover: thematic differences, visual environment, "
                "subject matter, and what each image communicates in context.\n\n"
                f"Comparison Context: {query or 'General Comparison'}\n\n"
                "\n\n".join(image_data) + "\n\n"
                "Return ONLY a JSON object with this schema: "
                "{\"shared_themes\": \"...\", \"unique_to_img1\": \"...\", \"unique_to_img2\": \"...\", \"narrative\": \"...\"}"
            )

            response = ImageAnalysisService._groq_client.chat.completions.create(
                model=ImageAnalysisService._model_name,
                messages=[
                    {"role": "system", "content": "You are a professional visual analyst. Always return valid JSON. The narrative field must be at least 60 words."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"},
                max_tokens=800,
                temperature=0.4
            )
            return json.loads(response.choices[0].message.content.strip())
        except Exception as e:
            logger.error("Groq image comparison failed: %s", e)
            return {
                "shared_themes": "Error during analysis",
                "unique_to_img1": "Error",
                "unique_to_img2": "Error",
                "narrative": "AI comparison is currently unavailable. Please check the metadata overlap manually below."
            }
