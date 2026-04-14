"""
image_services.py – Core machine learning logic for Image Processing Pipeline.
Integrates YOLOv8, CLIP, KMeans, UMAP, and Matplotlib.
"""

import io
import os
import uuid
import zipfile
import logging
import time
import tempfile
import json
from pathlib import Path

import numpy as np
from PIL import Image
import matplotlib.pyplot as plt
import matplotlib
matplotlib.use('Agg')  # Headless backend for fastAPI

# Machine Learning
from ultralytics import YOLO
import torch
from transformers import CLIPProcessor, CLIPModel, BlipProcessor, BlipForConditionalGeneration
from sklearn.cluster import KMeans
import umap
from groq import Groq

# Azure SDK
from azure.cognitiveservices.vision.computervision import ComputerVisionClient
from msrest.authentication import CognitiveServicesCredentials

from modules.team5_multimodal.config import get_settings
from modules.team5_multimodal.models import (
    DetectedObject, ClusterPoint, ZipPipelineResult, ClusterInfo
)

logger = logging.getLogger(__name__)

# Pre-load models so they aren't painfully loaded every API call
_groq_client = None

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

try:
    _blip_processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
    _blip_model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base")
except Exception as e:
    logger.error(f"Failed to load BLIP model: {e}")
    _blip_processor = None
    _blip_model = None


class ImageAnalysisService:
    def __init__(self):
        self.settings = get_settings()
        global _groq_client
        if _groq_client is None:
            _groq_client = Groq(api_key=self.settings.groq_api_key)

        # Ensure workspace directories exist
        self.base_dir = Path(__file__).resolve().parent.parent.parent
        self.raw_dir = self.base_dir / "shared_workspace" / "1_raw_uploads"
        self.proc_dir = self.base_dir / "shared_workspace" / "2_processed_data"
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.proc_dir.mkdir(parents=True, exist_ok=True)

        # Initialize Azure Client if keys exist (Skipped for Local BLIP)
        self.cv_client = None

    def extract_zip(self, zip_bytes: bytes) -> str:
        """Extracts zip blob into shared_workspace/1_raw_uploads/"""
        session_id = str(uuid.uuid4())[:8]
        out_dir = self.raw_dir / f"images_{session_id}"
        out_dir.mkdir(exist_ok=True)
        
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            zf.extractall(out_dir)
        return str(out_dir)

    def save_files(self, files: list) -> str:
        """Saves a list of UploadFile objects into shared_workspace/1_raw_uploads/"""
        session_id = str(uuid.uuid4())[:8]
        out_dir = self.raw_dir / f"batch_{session_id}"
        out_dir.mkdir(exist_ok=True)
        
        for file in files:
            file_path = out_dir / file.filename
            with open(file_path, "wb") as f:
                f.write(file.file.read())
        return str(out_dir)

    def get_image_description(self, img_path: str) -> str | None:
        """Use Local BLIP Model to describe image"""
        try:
            if _blip_model and _blip_processor:
                img = Image.open(img_path).convert("RGB")
                inputs = _blip_processor(img, return_tensors="pt")
                out = _blip_model.generate(**inputs)
                return _blip_processor.decode(out[0], skip_special_tokens=True)
            else:
                return "Local BLIP Model Not Loaded"
        except Exception as e:
            logger.error(f"BLIP Captioning Error on {img_path}: {e}")
        return None

    def _name_clusters(self, labels: np.ndarray, metadata: list[dict], n_clusters: int) -> tuple[list[ClusterInfo], dict]:
        """Use Groq to name all clusters in a single batch request for maximum speed."""
        cluster_info_list = []
        input_tokens = 0
        output_tokens = 0
        
        # Prepare batch prompt: Send samples from ALL groups in one go
        batch_input = []
        for c_id in range(n_clusters):
            indices = [i for i, lbl in enumerate(labels) if lbl == c_id]
            samples = [metadata[i]["description"] for i in indices[:5] if metadata[i]["description"]]
            batch_input.append(f"Group {c_id}: " + ", ".join(samples[:5]))
        
        all_descriptions = "\n".join(batch_input)
        
        try:
            response = _groq_client.chat.completions.create(
                model=self.settings.groq_model,
                messages=[
                    {"role": "system", "content": "You are a categorical classification expert. Provide a 2-3 word name for EACH group of images based on their descriptions. Return ONLY a JSON object: {\"Group 0\": \"Name\", \"Group 1\": \"Name\", ...}"},
                    {"role": "user", "content": f"Groups to name:\n{all_descriptions}"}
                ],
                response_format={"type": "json_object"}
            )
            
            names_json = json.loads(response.choices[0].message.content)
            
            for c_id in range(n_clusters):
                smart_name = names_json.get(f"Group {c_id}", f"Group {c_id + 1}")
                count = len([i for i, lbl in enumerate(labels) if lbl == c_id])
                cluster_info_list.append(ClusterInfo(cluster_id=c_id, description=smart_name, count=count))
                
            if hasattr(response, "usage") and response.usage:
                input_tokens = response.usage.prompt_tokens
                output_tokens = response.usage.completion_tokens
        except Exception as e:
            logger.warning(f"Batch cluster naming failed: {e}")
            for c_id in range(n_clusters):
                count = len([i for i, lbl in enumerate(labels) if lbl == c_id])
                cluster_info_list.append(ClusterInfo(cluster_id=c_id, description=f"Group {c_id + 1}", count=count))
            
        return cluster_info_list, {"input": input_tokens, "output": output_tokens, "total": input_tokens + output_tokens}

    def process_images(self, extract_dir: str) -> ZipPipelineResult:
        start_time = time.time()
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
        annotated_dir = self.proc_dir / f"annotated_{uuid.uuid4().hex[:8]}"
        annotated_dir.mkdir(parents=True, exist_ok=True)
        
        for img_path in image_files:
            str_path = str(img_path)
            
            # --- YOLO Object Detection ---
            objs = []
            rel_annotated_path = None
            if _yolo_model:
                results = _yolo_model(str_path, verbose=False, iou=0.3, conf=0.4)
                if len(results) > 0:
                    r = results[0]
                    boxes = r.boxes
                    for box in boxes:
                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        conf = float(box.conf[0])
                        cls = int(box.cls[0])
                        label = _yolo_model.names[cls]
                        objs.append(DetectedObject(label=label, confidence=conf, bbox=[x1, y1, x2, y2]))
                    
                    # Generate annotated image
                    im_array = r.plot()
                    im_pil = Image.fromarray(im_array[..., ::-1])
                    out_img = annotated_dir / img_path.name
                    im_pil.save(str(out_img))
                    rel_annotated_path = str(out_img.relative_to(self.base_dir))

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
                "description": desc,
                "annotated_path": rel_annotated_path
            })

        # 2. KMeans Clustering - Smart K-Estimation via Silhouette Score
        X = np.array(embeddings)
        n_samples = len(X)
        
        if n_samples <= 1:
            n_clusters = 1
            labels = np.zeros(n_samples, dtype=int)
        else:
            from sklearn.metrics import silhouette_score
            best_k = 2
            best_score = -1
            
            # Test different K values from 2 to 8 (or N-1)
            limit = min(8, n_samples - 1) 
            for k in range(2, limit + 1):
                km = KMeans(n_clusters=k, random_state=42, n_init="auto")
                l = km.fit_predict(X)
                score = silhouette_score(X, l)
                if score > best_score:
                    best_score = score
                    best_k = k
            
            n_clusters = best_k
            kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init="auto")
            labels = kmeans.fit_predict(X)

        # 3. UMAP Dimensionality Reduction
        # UMAP needs sufficient data for spectral initialization; default to random for small sets
        if len(X) > 1:
            reducer = umap.UMAP(n_neighbors=min(15, len(X)-1), n_components=2, random_state=42, init="random")
            coords = reducer.fit_transform(X)
        else:
            coords = np.array([[0.0, 0.0]])

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
                    description=metadata_list[i]["description"],
                    annotated_image_path=metadata_list[i]["annotated_path"]
                )
            )

        # 4. Smart Cluster Naming (New Team 5 Feature)
        cluster_summaries, tokens = self._name_clusters(labels, metadata_list, n_clusters)

        # 5. Matplotlib Output
        plot_path = self.proc_dir / f"cluster_plot_{uuid.uuid4().hex[:8]}.png"
        self._generate_plot(coords, labels, plot_path)

        total_duration = time.time() - start_time

        return ZipPipelineResult(
            clusters=cluster_points,
            cluster_summaries=cluster_summaries,
            plot_file_path=str(plot_path.relative_to(self.base_dir)),
            metadata={
                "total_duration_sec": round(total_duration, 2),
                "input_tokens": tokens["input"],
                "output_tokens": tokens["output"],
                "total_tokens": tokens["total"],
                "model": self.settings.groq_model
            }
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
