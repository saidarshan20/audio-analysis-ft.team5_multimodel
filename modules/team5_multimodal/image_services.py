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
from PIL import Image, ExifTags
import matplotlib.pyplot as plt
import matplotlib
matplotlib.use('Agg')  # Headless backend for fastAPI
from matplotlib.colors import ListedColormap

# HEIC/HEIF support is optional. Do not crash app startup if package is missing.
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
    _HEIF_AVAILABLE = True
except Exception:
    register_heif_opener = None  # type: ignore[assignment]
    _HEIF_AVAILABLE = False

# Machine Learning — each import is guarded individually so a single
# broken native library (e.g. torchcodec DLL, missing CUDA) does not
# prevent the rest of the stack from loading.
try:
    from ultralytics import YOLO
    _YOLO_AVAILABLE = True
except Exception:
    YOLO = None  # type: ignore[assignment, misc]
    _YOLO_AVAILABLE = False

try:
    import torch
    _TORCH_AVAILABLE = True
except Exception:
    torch = None  # type: ignore[assignment]
    _TORCH_AVAILABLE = False

try:
    from transformers import CLIPProcessor, CLIPModel, BlipProcessor, BlipForConditionalGeneration
    _TRANSFORMERS_AVAILABLE = True
except Exception:
    CLIPProcessor = CLIPModel = BlipProcessor = BlipForConditionalGeneration = None  # type: ignore[assignment, misc]
    _TRANSFORMERS_AVAILABLE = False

try:
    from sklearn.cluster import KMeans
    _SKLEARN_AVAILABLE = True
except Exception:
    KMeans = None  # type: ignore[assignment, misc]
    _SKLEARN_AVAILABLE = False

try:
    import umap
    _UMAP_AVAILABLE = True
except Exception:
    umap = None  # type: ignore[assignment]
    _UMAP_AVAILABLE = False

try:
    from groq import Groq
    _GROQ_AVAILABLE = True
except Exception:
    Groq = None  # type: ignore[assignment, misc]
    _GROQ_AVAILABLE = False

# Azure SDK — optional; presence of credentials checked at request time
try:
    from azure.cognitiveservices.vision.computervision import ComputerVisionClient
    from msrest.authentication import CognitiveServicesCredentials
    _AZURE_CV_AVAILABLE = True
except Exception:
    ComputerVisionClient = None  # type: ignore[assignment, misc]
    CognitiveServicesCredentials = None  # type: ignore[assignment, misc]
    _AZURE_CV_AVAILABLE = False

from modules.team5_multimodal.config import get_settings
from modules.team5_multimodal.models import (
    DetectedObject, ClusterPoint, ZipPipelineResult, ClusterInfo, TechnicalMetadata, GPSData
)

logger = logging.getLogger(__name__)

# Pre-load models so they aren't painfully loaded every API call
_groq_client = None

if _YOLO_AVAILABLE:
    try:
        _yolo_model = YOLO("yolov8n.pt")  # Use nano for speed
    except Exception as e:
        logger.error(f"Failed to load YOLO model: {e}")
        _yolo_model = None
else:
    _yolo_model = None

if _TRANSFORMERS_AVAILABLE:
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
else:
    _clip_model = _clip_processor = _blip_processor = _blip_model = None


class ImageAnalysisService:
    def __init__(self):
        self.settings = get_settings()
        global _groq_client
        if _groq_client is None and _GROQ_AVAILABLE and Groq is not None:
            _groq_client = Groq(api_key=self.settings.groq_api_key)

        # Ensure workspace directories exist
        self.base_dir = Path(__file__).resolve().parent.parent.parent
        self.raw_dir = self.base_dir / "shared_workspace" / "1_raw_uploads"
        self.proc_dir = self.base_dir / "shared_workspace" / "2_processed_data"
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.proc_dir.mkdir(parents=True, exist_ok=True)

        # Initialize Azure Client if keys exist (Skipped for Local BLIP)
        self.cv_client = None

    def _get_decimal_from_dms(self, dms, ref):
        if not dms or not ref: return None
        try:
            degrees = float(dms[0])
            minutes = float(dms[1])
            seconds = float(dms[2])
            decimal = degrees + (minutes / 60.0) + (seconds / 3600.0)
            if ref in ['S', 'W']: decimal = -decimal
            return decimal
        except (IndexError, TypeError, ValueError):
            return None

    def _extract_exif_metadata(self, img_path: str) -> TechnicalMetadata | None:
        """Extract Apple-style technical metadata and GPS from image files."""
        try:
            img = Image.open(img_path)
            exif = img.getexif()
            if not exif:
                return TechnicalMetadata(width=img.width, height=img.height)

            meta = TechnicalMetadata(width=img.width, height=img.height)
            
            # 1. Basic Info
            meta.make = str(exif.get(ExifTags.Base.Make, "")).strip() or None
            meta.model = str(exif.get(ExifTags.Base.Model, "")).strip() or None
            meta.datetime = str(exif.get(ExifTags.Base.DateTime, "")).strip() or None

            # 2. Detailed Specs (IFD 34665)
            exif_ifd = exif.get_ifd(ExifTags.IFD.Exif)
            if exif_ifd:
                meta.iso = str(exif_ifd.get(ExifTags.Base.ISOSpeedRatings, "")) or None
                meta.aperture = f"f/{exif_ifd.get(ExifTags.Base.FNumber)}" if exif_ifd.get(ExifTags.Base.FNumber) else None
                
                exp_time = exif_ifd.get(ExifTags.Base.ExposureTime)
                if exp_time:
                    try:
                        f_exp = float(exp_time)
                        if f_exp < 1.0:
                            meta.shutter_speed = f"1/{round(1.0/f_exp)}"
                        else:
                            meta.shutter_speed = f"{f_exp}"
                    except (ValueError, ZeroDivisionError):
                        meta.shutter_speed = str(exp_time)

                meta.focal_length = f"{exif_ifd.get(ExifTags.Base.FocalLength)}mm" if exif_ifd.get(ExifTags.Base.FocalLength) else None
                meta.focal_length_35mm = f"{exif_ifd.get(ExifTags.Base.FocalLengthIn35mmFilm)}mm" if exif_ifd.get(ExifTags.Base.FocalLengthIn35mmFilm) else None
                meta.lens = str(exif_ifd.get(ExifTags.Base.LensModel, "")).strip() or None

            # 3. GPS Info (IFD 34853)
            gps_ifd = exif.get_ifd(ExifTags.IFD.GPSInfo)
            if gps_ifd:
                # GPS tags are often best accessed by their integer IDs to avoid 'dict' attribute errors
                # Ref IDs: 1: LatRef, 2: Lat, 3: LngRef, 4: Lng, 6: Alt
                lat = self._get_decimal_from_dms(gps_ifd.get(2), gps_ifd.get(1))
                lng = self._get_decimal_from_dms(gps_ifd.get(4), gps_ifd.get(3))
                alt = float(gps_ifd.get(6, 0)) if gps_ifd.get(6) else None
                if lat is not None and lng is not None:
                    meta.gps = GPSData(lat=lat, lng=lng, altitude=alt)

            return meta
        except Exception as e:
            logger.warning(f"Metadata extraction failed for {img_path}: {e}")
            return None

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
        if _HEIF_AVAILABLE:
            valid_exts.update({".heic", ".heif"})
        else:
            logger.warning(
                "pillow-heif not installed: .heic/.heif files will be skipped. "
                "Install pillow-heif to enable HEIF support."
            )
        
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
                    
                    # Generate annotated image — always save as JPEG so browsers can render it
                    im_array = r.plot()
                    im_pil = Image.fromarray(im_array[..., ::-1]).convert("RGB")
                    out_img = annotated_dir / (img_path.stem + ".jpg")
                    im_pil.save(str(out_img), format="JPEG", quality=90)
                    rel_annotated_path = str(out_img.relative_to(self.base_dir))

            # --- CLIP Embeddings ---
            emb = np.zeros(512)
            try:
                if _clip_model and _clip_processor and _TORCH_AVAILABLE:
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

            # --- Technical Metadata ---
            tech_meta = self._extract_exif_metadata(str_path)

            # --- Azure Vision (Optional) ---
            desc = self.get_image_description(str_path)

            metadata_list.append({
                "filename": img_path.name,
                "objects": objs,
                "description": desc,
                "annotated_path": rel_annotated_path,
                "tech_meta": tech_meta
            })

        # 2. KMeans Clustering - Smart K-Estimation via Silhouette Score
        X = np.array(embeddings)
        n_samples = len(X)
        
        if n_samples <= 1 or not _SKLEARN_AVAILABLE or KMeans is None:
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
        # UMAP requires n_neighbors >= 2 AND n_neighbors < n_samples,
        # so we need at least 3 samples. Handle smaller sets with trivial layouts.
        if len(X) >= 3 and _UMAP_AVAILABLE and umap is not None:
            # For small data, lower n_neighbors pulls clusters much tighter together.
            n_neighbors = min(5, max(2, len(X) - 1))
            reducer = umap.UMAP(n_neighbors=n_neighbors, min_dist=0.01, n_components=2, random_state=42, init="random")
            coords = reducer.fit_transform(X)
        elif len(X) == 2:
            coords = np.array([[0.0, 0.0], [1.0, 0.0]])
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
                    annotated_image_path=metadata_list[i]["annotated_path"],
                    metadata=metadata_list[i]["tech_meta"]
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
        # Match frontend modulo logic perfectly
        hex_colors = ['#fb8c36', '#4ade80', '#60a5fa', '#a78bfa', '#f472b6']
        n_clusters = len(np.unique(labels))
        exact_colors = [hex_colors[i % len(hex_colors)] for i in range(max(1, n_clusters))]
        ui_cmap = ListedColormap(exact_colors)
        
        # Plot with matching UI colors (discrete bins matching discrete labels exactly)
        plt.figure(figsize=(10, 8))
        scatter = plt.scatter(coords[:, 0], coords[:, 1], c=labels, cmap=ui_cmap, vmin=0, vmax=max(1, n_clusters)-1, s=100, alpha=0.8)
        
        # Colorbar
        cbar = plt.colorbar(scatter, label='Cluster ID')
        cbar.set_ticks(range(n_clusters))
        
        plt.title('UMAP Projection of Image Embeddings')
        plt.xlabel('UMAP 1')
        plt.ylabel('UMAP 2')
        plt.grid(True, linestyle='--', alpha=0.6)
        plt.savefig(out_path, bbox_inches='tight')
        plt.close()
