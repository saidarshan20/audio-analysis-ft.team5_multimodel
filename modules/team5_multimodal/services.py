"""
services.py  –  Core business logic for Team 5 Multimodal.
Migrated from app/services/text_service.py.
"""

import io
import json
import logging
import re

import pdfplumber
from groq import AsyncGroq

from modules.team5_multimodal.config import get_settings
from modules.team5_multimodal.models import TextAnalysisResult

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert text analysis engine. Given the user's text, produce a single JSON object with EXACTLY these keys:

{
  "summary": "<3 concise sentences summarizing the text>",
  "topic": "<1-3 words describing the main topic>",
  "theme": "<1 sentence describing the overarching theme or core message>",
  "top_keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "sentiment": {
    "positive": <float 0-1>,
    "negative": <float 0-1>,
    "neutral": <float 0-1>,
    "overall_label": "<positive|negative|neutral|mixed>",
    "detailed_analysis": "<1-2 sentences explaining contextually why this sentiment was chosen>"
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
        
        # NLTK Word Frequency extraction
        try:
            import nltk
            from collections import Counter
            from nltk.corpus import stopwords
            from nltk.tokenize import word_tokenize
            
            # Ensure resources are available
            try:
                stop_words = set(stopwords.words('english'))
            except LookupError:
                nltk.download('stopwords', quiet=True)
                nltk.download('punkt', quiet=True)
                stop_words = set(stopwords.words('english'))
                
            # Clean and tokenize
            text_clean = re.sub(r'[^\w\s]', '', text.lower())
            tokens = word_tokenize(text_clean)
            
            # Filter stopwords and numeric strings
            filtered_tokens = [w for w in tokens if not w in stop_words and len(w) > 2 and not w.isnumeric()]
            
            # Count frequencies (Top 50)
            word_counts = Counter(filtered_tokens)
            top_words = word_counts.most_common(50)
            data['word_frequencies'] = [{"word": word, "count": count} for word, count in top_words]
            
            # Bigram Keyphrase extraction (Token reduction metric)
            bigrams = list(nltk.bigrams(filtered_tokens))
            bigram_counts = Counter(bigrams)
            top_bigrams = bigram_counts.most_common(5)
            data['top_keyphrases'] = [f"{w1} {w2}" for (w1, w2), _ in top_bigrams]
        except Exception as e:
            logger.warning(f"NLTK Word frequency extraction failed: {e}")
            data['word_frequencies'] = []
            data['top_keyphrases'] = []

        # Exact Count tracking
        data['char_count'] = len(text)
        words = [w for w in text.split() if w.strip()]
        data['word_count'] = len(words)
        sentences = [s for s in re.split(r'[.!?]+', text) if s.strip()]
        data['sentence_count'] = max(1, len(sentences)) if text.strip() else 0

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

    async def chat_with_transcript(self, transcript: str, history: list[dict], message: str) -> str:
        messages = [
            {"role": "system", "content": "You are a highly analytical assistant evaluating an audio transcript. Answer questions strictly utilizing the context provided. Transcript:\n\n" + transcript}
        ]
        for msg in history:
            messages.append({"role": msg["role"], "content": msg["content"]})
        
        messages.append({"role": "user", "content": message})

        response = await self._client.chat.completions.create(
            model=self._settings.groq_model,
            messages=messages,
            temperature=0.5,
        )
        return response.choices[0].message.content

