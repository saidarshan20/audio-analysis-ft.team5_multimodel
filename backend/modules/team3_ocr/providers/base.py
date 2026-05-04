"""
Abstract base classes for all providers.
Switch between local and Azure by changing OCR_PROVIDER in .env
"""

from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
from pathlib import Path


class OCRProviderBase(ABC):
    """Interface for OCR providers (Tesseract/EasyOCR → Azure Document Intelligence)."""

    @abstractmethod
    async def extract_text(self, file_path: Path, language: str = "auto") -> Dict[str, Any]:
        """
        Extract text from a document.
        Returns: {
            "pages": [{"page_number": 1, "text": "...", "confidence": 0.95}],
            "model_used": "tesseract"
        }
        """
        pass

    @abstractmethod
    async def extract_tables(self, file_path: Path) -> List[Dict[str, Any]]:
        """
        Extract tables from a document.
        Returns: [{"page_number": 1, "rows": [["h1","h2"],["v1","v2"]], "confidence": 0.9}]
        """
        pass


class NLPProviderBase(ABC):
    """Interface for NLP providers (spaCy/NLTK → Azure AI Language)."""

    @abstractmethod
    async def detect_language(self, text: str) -> Dict[str, Any]:
        """Returns: {"code": "en", "name": "English", "confidence": 0.99}"""
        pass

    @abstractmethod
    async def analyze_sentiment(self, text: str, language: str = "en") -> Dict[str, Any]:
        """Returns: {"overall": "positive", "score": 0.78, "per_sentence": [...]}"""
        pass

    @abstractmethod
    async def extract_entities(self, text: str, language: str = "en", custom_entities: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
        """Returns: [{"text": "John", "type": "PERSON", "start": 0, "end": 4, "confidence": 0.9}]"""
        pass

    @abstractmethod
    async def extract_keyphrases(self, text: str, language: str = "en") -> List[str]:
        """Returns: ["machine learning", "data pipeline"]"""
        pass

    @abstractmethod
    async def detect_intent(self, text: str, language: str = "en") -> Dict[str, Any]:
        """Returns: {"primary": "informational", "confidence": 0.85}"""
        pass

    @abstractmethod
    async def summarize(self, text: str, max_length: int = 150, language: str = "en") -> str:
        """Returns summarized text."""
        pass

    @abstractmethod
    async def analyze_risk(self, text: str, language: str = "en") -> List[Dict[str, Any]]:
        """Returns risk flags and compliance issues."""
        pass

    @abstractmethod
    async def extract_structured_entities(self, text: str, language: str = "en") -> Dict[str, Any]:
        """Returns mapped entity groups: people, orgs, amounts, dates, relationships."""
        pass

    @abstractmethod
    async def extract_actionable_insights(self, text: str, language: str = "en") -> Dict[str, Any]:
        """Returns takeaways and structured action items."""
        pass


class SearchProviderBase(ABC):
    """Interface for search providers (FAISS/ChromaDB → Azure AI Search)."""

    @abstractmethod
    async def index_document(self, doc_id: str, text: str, metadata: Dict[str, Any]) -> bool:
        """Index a document for semantic search."""
        pass

    @abstractmethod
    async def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """
        Search indexed documents.
        Returns: [{"doc_id": "...", "text_snippet": "...", "score": 0.95}]
        """
        pass

    @abstractmethod
    async def search_document(self, doc_id: str, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """
        Search within a single document's indexed chunks (used for RAG).
        Returns: [{"text_snippet": "...", "score": 0.95}]
        """
        pass

    @abstractmethod
    async def remove_document(self, doc_id: str) -> bool:
        """Remove a document from the search index."""
        pass
