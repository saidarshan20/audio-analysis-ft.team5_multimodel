"""
Local OCR provider using Tesseract and EasyOCR.
This is the development fallback — will be replaced by Azure Document Intelligence.
"""

import asyncio
from pathlib import Path
from typing import Dict, Any, List
from modules.team3_ocr.providers.base import OCRProviderBase
import logging

logger = logging.getLogger(__name__)


class LocalOCRProvider(OCRProviderBase):
    """OCR using Tesseract (printed text) and EasyOCR (handwritten + multilingual)."""

    def __init__(self):
        self._easyocr_reader = None

    def _get_easyocr_reader(self, languages: List[str] = None):
        """Lazy-load EasyOCR reader (heavy initialization)."""
        if self._easyocr_reader is None:
            try:
                import easyocr
                langs = languages or ["en"]
                self._easyocr_reader = easyocr.Reader(langs, gpu=False)
            except ImportError:
                logger.warning("EasyOCR not installed, falling back to Tesseract only")
        return self._easyocr_reader

    async def extract_text(self, file_path: Path, language: str = "auto") -> Dict[str, Any]:
        """Extract text from PDF or image using Tesseract."""
        file_ext = file_path.suffix.lower()

        if file_ext == ".pdf":
            return await self._extract_from_pdf(file_path, language)
        elif file_ext in [".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".webp"]:
            return await self._extract_from_image(file_path, language)
        else:
            raise ValueError(f"Unsupported file type: {file_ext}")

    async def _extract_from_pdf(self, file_path: Path, language: str) -> Dict[str, Any]:
        """Extract text from PDF using PyPDF2 (fast/offline). Fallback to Tesseract OCR if image-based."""
        def _process():
            pages_result = []
            # Step 1: Try PyPDF2 native extraction (does not require Tesseract app)
            try:
                import PyPDF2
                with open(file_path, "rb") as f:
                    reader = PyPDF2.PdfReader(f)
                    for i, page in enumerate(reader.pages):
                        text = page.extract_text()
                        if text and text.strip():
                            pages_result.append({
                                "page_number": i + 1,
                                "text": text.strip(),
                                "confidence": 1.0,  # Native PDF text is 100% accurate
                            })
                if pages_result:
                    return {"pages": pages_result, "model_used": "pypdf2_native"}
            except Exception as e:
                logger.warning(f"PyPDF2 failed: {e}")

            # Step 2: Fallback to EasyOCR if it's a scanned image PDF
            try:
                from pdf2image import convert_from_path
                import numpy as np
                
                images = convert_from_path(file_path)
                reader = self._get_easyocr_reader([language] if language != "auto" else ["en"])
                
                for i, image in enumerate(images):
                    # Convert PIL image to numpy array for EasyOCR
                    img_np = np.array(image)
                    # Get results (bbox, text, confidence)
                    results = reader.readtext(img_np)
                    
                    page_text = " ".join([res[1] for res in results])
                    page_conf = sum([res[2] for res in results]) / len(results) if results else 0
                    
                    pages_result.append({
                        "page_number": i + 1,
                        "text": page_text.strip(),
                        "confidence": round(page_conf, 2),
                    })
                return {"pages": pages_result, "model_used": "easyocr"}
            except Exception as e:
                logger.error(f"PDF OCR failed: {e}")
                return {"pages": [], "model_used": "easyocr", "error": str(e)}

        return await asyncio.to_thread(_process)

    async def _extract_from_image(self, file_path: Path, language: str) -> Dict[str, Any]:
        """OCR a single image using EasyOCR."""
        def _process():
            try:
                import numpy as np
                from PIL import Image
                reader = self._get_easyocr_reader([language] if language != "auto" else ["en"])
            except ImportError as e:
                return {"pages": [], "model_used": "easyocr", "error": str(e)}

            try:
                image = Image.open(file_path)
                img_np = np.array(image)
                
                # EasyOCR handles the extraction
                results = reader.readtext(img_np)
                
                text = " ".join([res[1] for res in results])
                avg_confidence = sum([res[2] for res in results]) / len(results) if results else 0

                return {
                    "pages": [{
                        "page_number": 1,
                        "text": text.strip(),
                        "confidence": round(avg_confidence, 2),
                    }],
                    "model_used": "easyocr",
                }
            except Exception as e:
                logger.error(f"Image OCR failed: {e}")
                return {"pages": [], "model_used": "easyocr", "error": str(e)}

        return await asyncio.to_thread(_process)

    async def extract_tables(self, file_path: Path) -> List[Dict[str, Any]]:
        """Extract tables from PDF using Camelot or Tabula."""
        file_ext = file_path.suffix.lower()
        if file_ext != ".pdf":
            return []

        def _process():
            # Try Camelot in both modes before falling back to Tabula.
            try:
                import camelot
                results = []

                for flavor in ("lattice", "stream"):
                    tables = camelot.read_pdf(str(file_path), pages="all", flavor=flavor)
                    for table in tables:
                        rows = table.df.values.tolist()
                        if not rows:
                            continue

                        results.append({
                            "page_number": table.page,
                            "rows": rows,
                            "confidence": round(table.accuracy / 100, 2) if hasattr(table, "accuracy") else None,
                        })

                    if results:
                        return results
            except Exception as e:
                logger.warning(f"Camelot failed ({e}), trying tabula...")

            try:
                import tabula
                dfs = tabula.read_pdf(str(file_path), pages="all", multiple_tables=True)
                results = []
                for i, df in enumerate(dfs):
                    results.append({
                        "page_number": i + 1,
                        "rows": [df.columns.tolist()] + df.values.tolist(),
                        "confidence": None,
                    })
                return results
            except Exception as e:
                logger.warning(f"Tabula failed ({e}), trying pdfplumber...")

            try:
                import pdfplumber
                results = []
                with pdfplumber.open(str(file_path)) as pdf:
                    for page_number, page in enumerate(pdf.pages, start=1):
                        tables = page.extract_tables() or []
                        for table in tables:
                            rows = [
                                ["" if cell is None else str(cell) for cell in row]
                                for row in table
                                if row and any(cell not in (None, "") for cell in row)
                            ]
                            if not rows:
                                continue

                            results.append({
                                "page_number": page_number,
                                "rows": rows,
                                "confidence": None,
                            })

                return results
            except Exception as e:
                logger.error(f"Table extraction failed: {e}")
                return []

        return await asyncio.to_thread(_process)
