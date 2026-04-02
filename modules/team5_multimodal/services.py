"""
services.py  –  Core business logic for Team 5 Multimodal.
Migrated from app/services/text_service.py.
"""

import io
import json
import logging

import pdfplumber
from groq import AsyncGroq

from modules.team5_multimodal.config import get_settings
from modules.team5_multimodal.models import TextAnalysisResult

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert text analysis engine. Given the user's text, produce a single JSON object with EXACTLY these keys:

{
  "summary": "<3 concise sentences summarizing the text>",
  "sentiment": {
    "positive": <float 0-1>,
    "negative": <float 0-1>,
    "neutral": <float 0-1>,
    "overall_label": "<positive|negative|neutral|mixed>"
  },
  "entities": [
    {"id": "<unique_snake_case>", "label": "<display name>", "type": "<Person|Place|Organization|Event|Concept>"}
  ],
  "kg_nodes": [
    {"id": "<unique_snake_case>", "label": "<display name>", "type": "<Person|Place|Organization|Event|Concept>"}
  ],
  "kg_edges": [
    {"source": "<kg_node.id>", "target": "<kg_node.id>", "relation": "<verb or relationship>"}
  ],
  "timeline": [
    {"date": "<ISO-8601 or descriptive date>", "description": "<what happened>"}
  ],
  "locations": [
    {"name": "<place name>", "lat": <latitude>, "lng": <longitude>}
  ]
}

Rules:
- `entities` lists all extracted named entities. `kg_nodes` must be a superset of `entities` and may include additional abstract concepts.
- Every `source` / `target` in `kg_edges` MUST reference an `id` from `kg_nodes`.
- If no dates are found, return an empty `timeline` array.
- If no locations are found, return an empty `locations` array.
- Sentiment scores must sum to ~1.0.
- Return ONLY the raw JSON object. No markdown fences, no commentary."""


_groq_client: AsyncGroq | None = None


def _get_groq_client() -> AsyncGroq:
    global _groq_client
    if _groq_client is None:
        s = get_settings()
        _groq_client = AsyncGroq(api_key=s.groq_api_key)
    return _groq_client


class TextAnalysisService:
    def __init__(self) -> None:
        self._client: AsyncGroq = _get_groq_client()
        self._settings = get_settings()

    async def analyze(self, text: str) -> TextAnalysisResult:
        """Send text to Groq LLM and parse the structured JSON response."""
        response = await self._client.chat.completions.create(
            model=self._settings.groq_model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
            temperature=0.1,
        )

        raw = response.choices[0].message.content
        logger.debug("LLM raw response: %s", raw)

        data = json.loads(raw)  # type: ignore[arg-type]
        return TextAnalysisResult.model_validate(data)

    @staticmethod
    def extract_pdf_text(pdf_bytes: bytes) -> str:
        """Extract text from a PDF using pdfplumber (local, no cloud dependency)."""
        text_parts: list[str] = []
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)
        return "\n".join(text_parts)


