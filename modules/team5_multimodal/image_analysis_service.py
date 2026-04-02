import io
import logging
import torch
import numpy as np
from PIL import Image
from ultralytics import YOLO
from transformers import BlipProcessor, BlipForConditionalGeneration
from sentence_transformers import SentenceTransformer
from sklearn.cluster import KMeans
import umap

from modules.team5_multimodal.config import get_settings
from modules.team5_multimodal.models import (
    ImageAnalysisResult, 
    DetectionBox, 
    ProjectionPoint, 
    ClusterInfo
)

logger = logging.getLogger(__name__)

class ImageAnalysisService:
    """
    Local multi-modal image analysis service.
    Uses YOLOv8 for detection, BLIP for captioning, and CLIP for embeddings.
    """
    _yolo_model = None
    _caption_processor = None
    _caption_model = None
    _embed_model = None

    def __init__(self):
        self.settings = get_settings()
        self._load_models()

    def _load_models(self):
        """Lazy load models into class variables to share across instances."""
        if ImageAnalysisService._yolo_model is None:
            logger.info("Loading YOLOv8 model from %s...", self.settings.yolo_model)
            # YOLO(path) will download the weights if not found locally
            ImageAnalysisService._yolo_model = YOLO(self.settings.yolo_model)

        if ImageAnalysisService._caption_model is None:
            logger.info("Loading BLIP captioning model from %s...", self.settings.caption_model)
            # from_pretrained is the standard method for HF models
            ImageAnalysisService._caption_processor = BlipProcessor.from_pretrained(self.settings.caption_model)
            ImageAnalysisService._caption_model = BlipForConditionalGeneration.from_pretrained(self.settings.caption_model)

        if ImageAnalysisService._embed_model is None:
            logger.info("Loading CLIP embedding model from %s...", self.settings.embedding_model)
            ImageAnalysisService._embed_model = SentenceTransformer(self.settings.embedding_model)

    def analyze_image(self, image_bytes: bytes, filename: str) -> tuple[ImageAnalysisResult, np.ndarray]:
        """Perform detection, captioning, and embedding for a single image."""
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        
        # 1. YOLO Detection
        results = ImageAnalysisService._yolo_model(img, verbose=False)[0]
        detections = []
        for box in results.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            label = results.names[int(box.cls[0])]
            detections.append(DetectionBox(
                label=label, 
                confidence=conf,
                box=[x1, y1, x2, y2]
            ))

        # 2. BLIP Captioning
        inputs = ImageAnalysisService._caption_processor(img, return_tensors="pt")
        out = ImageAnalysisService._caption_model.generate(**inputs)
        caption = ImageAnalysisService._caption_processor.decode(out[0], skip_special_tokens=True)

        # 3. CLIP Embedding (using SentenceTransformer CLIP wrapper)
        embedding = ImageAnalysisService._embed_model.encode(img)
        
        result = ImageAnalysisResult(
            filename=filename,
            caption=caption,
            detections=detections
        )
        return result, embedding

    def perform_clustering(self, embeddings: list[np.ndarray], filenames: list[str]) -> tuple[list[ProjectionPoint], list[ClusterInfo]]:
        """Run UMAP for 2D coords and KMeans for clustering."""
        if not embeddings:
            return [], []

        data = np.array(embeddings)
        n_samples = len(data)
        
        # 1. UMAP Projection (2D)
        # Handle small datasets gracefully
        if n_samples > 5:
            n_neighbors = min(n_samples - 1, 15)
            reducer = umap.UMAP(n_neighbors=n_neighbors, min_dist=0.1, n_components=2, random_state=42)
            projection = reducer.fit_transform(data)
        elif n_samples > 1:
            # For very small datasets, UMAP can be unstable with sparse solver errors
            # Falling back to a simple linear projection or very loose UMAP
            from sklearn.decomposition import PCA
            reducer = PCA(n_components=2)
            projection = reducer.fit_transform(data)
        else:
            projection = np.array([[0.0, 0.0]])

        # 2. KMeans Clustering
        n_clusters = min(n_samples, 5) # Max 5 clusters for display
        if n_samples > 1:
            kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init='auto')
            cluster_labels = kmeans.fit_predict(data)
        else:
            cluster_labels = np.array([0])

        # 3. Format ProjectionPoints
        points = []
        for i in range(n_samples):
            points.append(ProjectionPoint(
                x=float(projection[i, 0]),
                y=float(projection[i, 1]),
                cluster=int(cluster_labels[i]),
                filename=filenames[i]
            ))

        # 4. Summarize Clusters
        clusters = []
        for c_id in range(n_clusters):
            count = int(np.sum(cluster_labels == c_id))
            clusters.append(ClusterInfo(
                cluster_id=c_id,
                description=f"Group {c_id + 1}",
                count=count
            ))

        return points, clusters
