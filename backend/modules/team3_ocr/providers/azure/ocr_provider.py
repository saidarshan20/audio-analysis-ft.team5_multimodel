"""
Azure OCR provider using Azure AI Document Intelligence.
"""

import asyncio
from pathlib import Path
from typing import Any, Dict, List, Optional

from modules.team3_ocr.providers.base import OCRProviderBase


class AzureOCRProvider(OCRProviderBase):
    """OCR and table extraction using Azure AI Document Intelligence."""

    def __init__(self, endpoint: Optional[str], key: Optional[str]):
        if not endpoint or not key:
            raise ValueError(
                "Azure OCR provider requires AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and "
                "AZURE_DOCUMENT_INTELLIGENCE_KEY."
            )

        try:
            from azure.ai.documentintelligence import DocumentIntelligenceClient
            from azure.core.credentials import AzureKeyCredential
        except ImportError as exc:
            raise RuntimeError(
                "Azure OCR provider requires the 'azure-ai-documentintelligence' package. "
                "Install backend dependencies and restart the server."
            ) from exc

        self.client = DocumentIntelligenceClient(
            endpoint=endpoint,
            credential=AzureKeyCredential(key),
        )

    async def extract_text(self, file_path: Path, language: str = "auto") -> Dict[str, Any]:
        return await asyncio.to_thread(self._extract_text_sync, file_path, language)

    async def extract_tables(self, file_path: Path) -> List[Dict[str, Any]]:
        return await asyncio.to_thread(self._extract_tables_sync, file_path)

    def _extract_text_sync(self, file_path: Path, language: str) -> Dict[str, Any]:
        locale = None if language == "auto" else language
        with open(file_path, "rb") as document:
            poller = self.client.begin_analyze_document(
                "prebuilt-layout",
                body=document,
                locale=locale,
                output_content_format="markdown",
            )
            result = poller.result()

        pages = []
        for page in result.pages or []:
            pages.append(
                {
                    "page_number": page.page_number,
                    "text": self._page_text(result, page).strip(),
                    "confidence": self._page_confidence(page),
                }
            )

        return {"pages": pages, "model_used": "azure_document_intelligence"}

    def _extract_tables_sync(self, file_path: Path) -> List[Dict[str, Any]]:
        with open(file_path, "rb") as document:
            poller = self.client.begin_analyze_document("prebuilt-layout", body=document)
            result = poller.result()

        tables: List[Dict[str, Any]] = []
        for table in result.tables or []:
            rows = [["" for _ in range(table.column_count)] for _ in range(table.row_count)]
            for cell in table.cells or []:
                if cell.row_index < table.row_count and cell.column_index < table.column_count:
                    rows[cell.row_index][cell.column_index] = (cell.content or "").strip()

            page_number = 1
            if table.bounding_regions:
                page_number = table.bounding_regions[0].page_number

            tables.append(
                {
                    "page_number": page_number,
                    "rows": rows,
                    "confidence": getattr(table, "confidence", None),
                }
            )

        return tables

    @staticmethod
    def _page_text(result: Any, page: Any) -> str:
        content = getattr(result, "content", "") or ""
        spans = getattr(page, "spans", None) or []
        if not content or not spans:
            return ""

        chunks = []
        for span in spans:
            offset = getattr(span, "offset", 0) or 0
            length = getattr(span, "length", 0) or 0
            if length > 0:
                chunks.append(content[offset:offset + length])
        return "".join(chunks)

    @staticmethod
    def _page_confidence(page: Any) -> Optional[float]:
        words = getattr(page, "words", None) or []
        confidences = [
            word.confidence
            for word in words
            if getattr(word, "confidence", None) is not None
        ]
        if not confidences:
            return None
        return round(sum(confidences) / len(confidences), 2)
