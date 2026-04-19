"""
services.py  –  Core business logic for Team 5 Multimodal.
Migrated from app/services/text_service.py.
Updated with full LLM prompt for audio analysis features.
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


def _split_sentences(text: str) -> list[str]:
    parts = re.split(r'(?<=[.!?])\s+|\n+', text or "")
    return [p.strip() for p in parts if p and p.strip()]


def _cap(items: list[str], limit: int) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        norm = item.strip()
        if not norm:
            continue
        key = norm.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(norm)
        if len(out) >= limit:
            break
    return out


def _fallback_structured_fields(text: str, data: dict) -> None:
    sentences = _split_sentences(text)

    if not data.get("bullet_points"):
        data["bullet_points"] = _cap(sentences[:3], 3)

    if not data.get("questions"):
        data["questions"] = _cap([s for s in sentences if s.endswith("?")], 8)

    if not data.get("unanswered_questions"):
        unresolved_markers = ("open", "pending", "unresolved", "unknown", "tbd", "follow up")
        data["unanswered_questions"] = _cap(
            [q for q in data.get("questions", []) if any(m in q.lower() for m in unresolved_markers)],
            6,
        )

    decision_markers = (
        "we will", "we'll", "decide", "decided", "decision", "approved",
        "finalize", "finalized", "going with", "selected", "plan is to",
    )
    if not data.get("decisions"):
        decisions = [s for s in sentences if any(m in s.lower() for m in decision_markers)]
        data["decisions"] = _cap(decisions, 8)

    agreement_markers = ("agree", "agreed", "sounds good", "works for me", "exactly", "yes,")
    if not data.get("agreements"):
        agreements = [s for s in sentences if any(m in s.lower() for m in agreement_markers)]
        data["agreements"] = _cap(agreements, 8)

    disagreement_markers = (
        "disagree", "however", "but ", "concern", "risk", "issue",
        "not sure", "don't think", "instead",
    )
    if not data.get("disagreements"):
        disagreements = [s for s in sentences if any(m in s.lower() for m in disagreement_markers)]
        data["disagreements"] = _cap(disagreements, 8)

    action_markers = ("need to", "should", "must", "action", "todo", "next step", "follow up", "please")
    if not data.get("action_items"):
        actions = [s for s in sentences if any(m in s.lower() for m in action_markers)]
        data["action_items"] = _cap(actions, 8)

    if not data.get("topic_segments"):
        topic = (data.get("topic") or "General").strip() or "General"
        segments = [{"segment": s, "topic": topic} for s in sentences[:8]]
        data["topic_segments"] = segments

    if not data.get("sentence_sentiments"):
        data["sentence_sentiments"] = [
            {"sentence": s, "sentiment": "neutral"} for s in sentences[:12]
        ]

    # Ensure array fields exist even if there was no match.
    for key in [
        "bullet_points",
        "action_items",
        "topic_segments",
        "questions",
        "unanswered_questions",
        "decisions",
        "agreements",
        "disagreements",
        "sentence_sentiments",
    ]:
        if not isinstance(data.get(key), list):
            data[key] = []


SYSTEM_PROMPT = """You are an expert text analysis engine. Given the user's text, produce a single JSON object with EXACTLY these keys:

{
  "summary": "<3 concise sentences summarizing the text>",
  "bullet_points": ["<key takeaway 1>", "<key takeaway 2>", "<key takeaway 3>"],
  "action_items": ["<clear action item 1>", "<clear action item 2>"],
  "topic": "<1-3 words describing the main topic>",
  "theme": "<1 sentence describing the overarching theme or core message>",
  "emotion": "<primary emotion in one word>",
  "tone": "<tone label such as Formal/Informal/Urgent/Collaborative>",
  "domain": "<domain label such as Business/Engineering/Education/Healthcare/Food/Other>",
  "environment": "<meeting/chat/report/interview/presentation/other>",
  "topic_segments": [
    {"segment": "<short excerpt or section summary>", "topic": "<topic label>"}
  ],
  "questions": ["<question raised in the text>"],
  "unanswered_questions": ["<question still unresolved in the text>"],
  "decisions": ["<explicit decision made>"],
  "agreements": ["<explicit agreement>"],
  "disagreements": ["<explicit disagreement/conflict>"],
  "sentence_sentiments": [
    {"sentence": "<important sentence>", "sentiment": "<positive|negative|neutral>"}
  ],
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
- Keep `topic_segments` concise (max 8 items).
- Keep `sentence_sentiments` concise (max 12 items), prioritizing informative lines.
- If no dates are found, return an empty `timeline` array.
- If no locations are found, return an empty `locations` array.
- If no decisions/agreements/disagreements/questions are present, return empty arrays for those keys.
- Sentiment scores must sum to ~1.0.
- `emotion` must be exactly ONE word (e.g. "Appreciation", "Frustration", "Curiosity", "Neutral").
- `tone` must be capitalized (e.g. "Informal Tone", "Formal", "Collaborative").
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
        list_fields = [
            "bullet_points",
            "action_items",
            "topic_segments",
            "questions",
            "unanswered_questions",
            "decisions",
            "agreements",
            "disagreements",
            "sentence_sentiments",
            "top_keywords",
            "entities",
            "kg_nodes",
            "kg_edges",
            "timeline",
            "locations",
        ]
        for key in list_fields:
            if not isinstance(data.get(key), list):
                data[key] = []
        for key in ["summary", "topic", "theme", "emotion", "tone", "domain", "environment"]:
            if not isinstance(data.get(key), str):
                data[key] = ""
        _fallback_structured_fields(text, data)

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
            filtered_tokens = [w for w in tokens if w not in stop_words and len(w) > 2 and not w.isnumeric()]

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
