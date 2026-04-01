import json
import logging

from azure.ai.documentintelligence.models import AnalyzeDocumentRequest
from openai import AsyncAzureOpenAI

from app.core.azure_clients import get_doc_intelligence_client, get_openai_client
from app.core.config import get_settings
from app.models.text_models import TextAnalysisResult

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


class TextAnalysisService:
    def __init__(self) -> None:
        self._openai: AsyncAzureOpenAI = get_openai_client()
        self._settings = get_settings()

    async def analyze(self, text: str) -> TextAnalysisResult:
        """Send text to GPT-4o and parse the structured JSON response."""
        response = await self._openai.chat.completions.create(
            model=self._settings.azure_openai_deployment,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
            temperature=0.1,
        )

        raw = response.choices[0].message.content
        logger.debug("GPT-4o raw response: %s", raw)

        data = json.loads(raw)  # type: ignore[arg-type]
        return TextAnalysisResult.model_validate(data)

    async def extract_pdf_text(self, pdf_bytes: bytes) -> str:
        """Use Azure Document Intelligence to OCR / extract text from a PDF."""
        client = get_doc_intelligence_client()

        poller = await client.begin_analyze_document(
            model_id="prebuilt-read",
            body=AnalyzeDocumentRequest(bytes_source=pdf_bytes),
        )
        result = await poller.result()
        return result.content or ""
