"""
image_services.py – Core machine learning logic for Image Processing Pipeline.
Integrates YOLOv8, CLIP, KMeans, UMAP, and Matplotlib.
"""

import io
import os
import uuid
import zipfile
import logging
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
import matplotlib.pyplot as plt
import matplotlib
matplotlib.use('Agg')  # Headless backend for fastAPI

# Machine Learning
from ultralytics import YOLO
import torch
from transformers import CLIPProcessor, CLIPModel
from sklearn.cluster import KMeans
import umap

# Azure SDK
from azure.cognitiveservices.vision.computervision import ComputerVisionClient
from msrest.authentication import CognitiveServicesCredentials

from modules.team5_multimodal.config import get_settings
from modules.team5_multimodal.models import (
    DetectedObject, ClusterPoint, ImageAnalysisResult
)

logger = logging.getLogger(__name__)

# Pre-load models so they aren't painfully loaded every API call
try:
    _yolo_model = YOLO("yolov8n.pt")  # Use nano for speed
except Exception as e:
    logger.error(f"Failed to load YOLO model: {e}")
    _yolo_model = None

try:
    _clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
    _clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
except Exception as e:
    logger.error(f"Failed to load CLIP model: {e}")
    _clip_model = None
    _clip_processor = None


class ImageAnalysisService:
    def __init__(self):
        self.settings = get_settings()
        # Ensure workspace directories exist
        self.base_dir = Path(__file__).resolve().parent.parent.parent
        self.raw_dir = self.base_dir / "shared_workspace" / "1_raw_uploads"
        self.proc_dir = self.base_dir / "shared_workspace" / "2_processed_data"
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.proc_dir.mkdir(parents=True, exist_ok=True)

        # Initialize Azure Client if keys exist
        self.cv_client = None
        key = self.settings.azure_vision_key
        endpoint = self.settings.azure_vision_endpoint
        if key and endpoint:
            self.cv_client = ComputerVisionClient(endpoint, CognitiveServicesCredentials(key))

    def extract_zip(self, zip_bytes: bytes) -> str:
        """Extracts zip blob into shared_workspace/1_raw_uploads/"""
        session_id = str(uuid.uuid4())[:8]
        out_dir = self.raw_dir / f"images_{session_id}"
        out_dir.mkdir(exist_ok=True)
        
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            zf.extractall(out_dir)
        return str(out_dir)

    def get_image_description(self, img_path: str) -> str | None:
        """Use Azure AI Vision to describe image (if configured)"""
        if not self.cv_client:
            return "No Azure Keys Configured"
        try:
            with open(img_path, "rb") as img_stream:
                analysis = self.cv_client.describe_image_in_stream(img_stream)
                if analysis.captions:
                    return analysis.captions[0].text
        except Exception as e:
            logger.error(f"Azure API Error on {img_path}: {e}")
        return None

    def process_images(self, extract_dir: str) -> ImageAnalysisResult:
        root = Path(extract_dir)
        valid_exts = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
        
        image_files = []
        for path in root.rglob("*"):
            if path.suffix.lower() in valid_exts:
                # Skip hidden MacOS generated files
                if path.name.startswith("._") or "__MACOSX" in path.parts:
                    continue
                image_files.append(path)

        if len(image_files) == 0:
            raise ValueError("No valid image files found in the ZIP.")

        # Data arrays
        embeddings = []
        metadata_list = []

        # 1. Pipeline: YOLO + CLIP + Azure
        for img_path in image_files:
            str_path = str(img_path)
            
            # --- YOLO Object Detection ---
            objs = []
            if _yolo_model:
                results = _yolo_model(str_path, verbose=False)
                for r in results:
                    boxes = r.boxes
                    for box in boxes:
                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        conf = float(box.conf[0])
                        cls = int(box.cls[0])
                        label = _yolo_model.names[cls]
                        objs.append(DetectedObject(label=label, confidence=conf, bbox=[x1, y1, x2, y2]))

            # --- CLIP Embeddings ---
            emb = np.zeros(512)
            try:
                if _clip_model and _clip_processor:
                    image = Image.open(str_path).convert("RGB")
                    inputs = _clip_processor(images=image, return_tensors="pt")
                    with torch.no_grad():
                        features = _clip_model.get_image_features(**inputs)
                        # Fix for different Transformers versions returning different object types
                        if hasattr(features, "detach"):
                            emb = features.detach().numpy()[0]
                        elif hasattr(features, "image_embeds"):
                            emb = features.image_embeds.detach().numpy()[0]
                        else:
                            emb = features.pooler_output.detach().numpy()[0]
            except Exception as e:
                logger.error(f"CLIP failed for {str_path}: {e}")

            embeddings.append(emb)

            # --- Azure Vision (Optional) ---
            desc = self.get_image_description(str_path)

            metadata_list.append({
                "filename": img_path.name,
                "objects": objs,
                "description": desc
            })

        # 2. KMeans Clustering
        X = np.array(embeddings)
        n_clusters = min(3, len(X))  # Dynamic clusters based on size
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init="auto")
        labels = kmeans.fit_predict(X)

        # 3. UMAP Dimensionality Reduction
        # UMAP needs sufficient data for spectral initialization; default to random for small sets
        if len(X) > 3:
            reducer = umap.UMAP(n_neighbors=min(15, len(X)-1), n_components=2, random_state=42, init="random")
            coords = reducer.fit_transform(X)
        else:
            # Fallback to simple random coordinates if less than 4 images
            import random
            coords = np.array([[random.uniform(-10, 10), random.uniform(-10, 10)] for _ in range(len(X))])

        # Construct final ClusterPoint Array
        cluster_points = []
        for i in range(len(X)):
            cluster_points.append(
                ClusterPoint(
                    filename=metadata_list[i]["filename"],
                    cluster_id=int(labels[i]),
                    umap_x=float(coords[i][0]),
                    umap_y=float(coords[i][1]),
                    objects=metadata_list[i]["objects"],
                    description=metadata_list[i]["description"]
                )
            )

        # 4. Matplotlib Output
        plot_path = self.proc_dir / f"cluster_plot_{uuid.uuid4().hex[:8]}.png"
        self._generate_plot(coords, labels, plot_path)

        return ImageAnalysisResult(
            clusters=cluster_points,
            plot_file_path=str(plot_path.relative_to(self.base_dir))
        )

    def _generate_plot(self, coords, labels, out_path: Path):
        """Generates a headless matplotlib scatter plot of the clusters"""
        plt.figure(figsize=(10, 8))
        scatter = plt.scatter(coords[:, 0], coords[:, 1], c=labels, cmap='viridis', s=100, alpha=0.8)
        plt.colorbar(scatter, label='Cluster ID')
        plt.title('UMAP Projection of Image Embeddings')
        plt.xlabel('UMAP 1')
        plt.ylabel('UMAP 2')
        plt.grid(True, linestyle='--', alpha=0.6)
        plt.savefig(out_path, bbox_inches='tight')
        plt.close()

