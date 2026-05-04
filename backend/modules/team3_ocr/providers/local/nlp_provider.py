"""
Local NLP provider using spaCy + NLTK.
This is the core NLP engine — supplements with Azure AI Language when available.
"""

import asyncio
import re
from typing import Dict, Any, List
from modules.team3_ocr.providers.base import NLPProviderBase
import logging

logger = logging.getLogger(__name__)

# Mapping of language codes to spaCy model names
SPACY_MODELS = {
    "en": "en_core_web_sm",
    "es": "es_core_news_sm",
    "fr": "fr_core_news_sm",
    "de": "de_core_news_sm",
    "zh": "zh_core_web_sm",
    "ja": "ja_core_news_sm",
    "pt": "pt_core_news_sm",
    "it": "it_core_news_sm",
    "nl": "nl_core_news_sm",
    "ru": "ru_core_news_sm",
}


class LocalNLPProvider(NLPProviderBase):
    """NLP using spaCy + NLTK — multilingual with auto language detection."""

    def __init__(self):
        self._spacy_models = {}
        self._ensure_nltk_data()

    def _ensure_nltk_data(self):
        """Download required NLTK data on first use."""
        try:
            import nltk
            for resource in ["vader_lexicon", "punkt", "punkt_tab", "averaged_perceptron_tagger",
                             "averaged_perceptron_tagger_eng", "stopwords"]:
                try:
                    nltk.data.find(f"tokenizers/{resource}" if "punkt" in resource else resource)
                except LookupError:
                    nltk.download(resource, quiet=True)
        except ImportError:
            logger.warning("NLTK not installed")

    def _get_spacy_model(self, language: str = "en"):
        """Load spaCy model for the given language, with fallback to English."""
        if language not in self._spacy_models:
            try:
                import spacy
                model_name = SPACY_MODELS.get(language, SPACY_MODELS.get("en", "en_core_web_sm"))
                try:
                    self._spacy_models[language] = spacy.load(model_name)
                except Exception as e:
                    # Model not downloaded or proxy blocked — fail gracefully
                    logger.warning(f"spaCy model {model_name} not found or failed to load: {e}")
                    self._spacy_models[language] = None
            except ImportError:
                logger.error("spaCy not installed")
                return None
        return self._spacy_models[language]

    def _split_sentences(self, text: str) -> List[str]:
        sentences = re.split(r"(?<=[.!?])\s+|\n+", text)
        return [sentence.strip() for sentence in sentences if sentence and sentence.strip()]

    def _extract_dates(self, text: str) -> List[str]:
        patterns = [
            r"\b\d{1,2}/\d{1,2}/\d{2,4}\b",
            r"\b\d{4}-\d{2}-\d{2}\b",
            r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b",
            r"\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?,?\s+\d{4}\b",
        ]
        matches: List[str] = []
        for pattern in patterns:
            matches.extend(re.findall(pattern, text, flags=re.IGNORECASE))
        return matches[:10]

    def _extract_amounts(self, text: str) -> List[str]:
        patterns = [
            r"\$\s?\d[\d,]*(?:\.\d{2})?",
            r"\bUSD\s?\d[\d,]*(?:\.\d{2})?\b",
            r"\b\d[\d,]*(?:\.\d{2})?\s?(?:USD|dollars|eur|gbp)\b",
        ]
        matches: List[str] = []
        for pattern in patterns:
            matches.extend(re.findall(pattern, text, flags=re.IGNORECASE))
        return matches[:10]

    def _unique_nonempty(self, values: List[str], limit: int = 10) -> List[str]:
        seen = set()
        result: List[str] = []
        for value in values:
            cleaned = value.strip()
            if not cleaned:
                continue
            lowered = cleaned.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            result.append(cleaned)
            if len(result) >= limit:
                break
        return result

    async def detect_language(self, text: str) -> Dict[str, Any]:
        """Detect language using langdetect."""
        def _detect():
            try:
                from langdetect import detect, detect_langs

                code = detect(text)
                probs = detect_langs(text)
                confidence = probs[0].prob if probs else 0.0

                lang_names = {
                    "en": "English", "es": "Spanish", "fr": "French", "de": "German",
                    "zh-cn": "Chinese", "ja": "Japanese", "ko": "Korean", "pt": "Portuguese",
                    "it": "Italian", "nl": "Dutch", "ru": "Russian", "ar": "Arabic",
                    "hi": "Hindi", "tr": "Turkish", "pl": "Polish", "sv": "Swedish",
                }

                return {
                    "code": code,
                    "name": lang_names.get(code, code.upper()),
                    "confidence": round(confidence, 2),
                }
            except Exception as e:
                logger.error(f"Language detection failed: {e}")
                return {"code": "en", "name": "English", "confidence": 0.0}

        return await asyncio.to_thread(_detect)

    async def analyze_sentiment(self, text: str, language: str = "en") -> Dict[str, Any]:
        """Sentiment analysis using TextBlob (completely offline, immune to SSL blocks)."""
        def _analyze():
            try:
                from textblob import TextBlob
                
                # Full text polarity (-1.0 to 1.0)
                blob = TextBlob(text)
                compound = blob.sentiment.polarity

                # Determine overall sentiment
                if compound >= 0.05:
                    overall = "positive"
                elif compound <= -0.05:
                    overall = "negative"
                else:
                    overall = "neutral"

                # Per-sentence analysis (using manual split to avoid NLTK punkt downloads)
                per_sentence = []
                try:
                    import re
                    # Simple split by punctuation to avoid downloading NLTK sentence tokenizers
                    sentences = re.split(r'(?<=[.!?]) +', text)
                    for sent in sentences[:20]:  # Limit to first 20 sentences
                        if not sent.strip(): continue
                        sent_score = TextBlob(sent).sentiment.polarity
                        per_sentence.append({
                            "text": sent[:200],
                            "score": round(sent_score, 3),
                            "sentiment": "positive" if sent_score >= 0.05
                                        else "negative" if sent_score <= -0.05
                                        else "neutral",
                        })
                except Exception as e:
                    logger.warning(f"Sentence split failed: {e}")

                return {
                    "overall": overall,
                    "score": round(compound, 3),
                    "per_sentence": per_sentence,
                }
            except Exception as e:
                logger.error(f"Sentiment analysis failed: {e}")
                return {"overall": "neutral", "score": 0.0, "per_sentence": []}

        return await asyncio.to_thread(_analyze)

    async def extract_entities(self, text: str, language: str = "en", custom_entities: List[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Named Entity Recognition using spaCy + Custom keyword matching."""
        def _extract():
            nlp = self._get_spacy_model(language)
            entities = []
            seen = set()

            if nlp is not None:
                doc = nlp(text[:100000])  # Limit text length for performance
                for ent in doc.ents:
                    key = (ent.text, ent.label_, ent.start_char)
                    if key not in seen:
                        seen.add(key)
                        entities.append({
                            "text": ent.text,
                            "type": ent.label_,
                            "start": ent.start_char,
                            "end": ent.end_char,
                            "confidence": None,  # spaCy doesn't provide per-entity confidence
                        })

            # Custom keyword extracting for specialized fields
            if custom_entities:
                text_lower = text.lower()
                for custom_ent in custom_entities:
                    label = custom_ent.get("label", "CUSTOM")
                    for kw in custom_ent.get("keywords", []):
                        kw_lower = kw.lower()
                        if not kw_lower: continue
                        start_idx = 0
                        while True:
                            idx = text_lower.find(kw_lower, start_idx)
                            if idx == -1: break
                            
                            kw_len = len(kw)
                            exact_text = text[idx:idx + kw_len]
                            key = (exact_text, label, idx)
                            if key not in seen:
                                seen.add(key)
                                entities.append({
                                    "text": exact_text,
                                    "type": label,
                                    "start": idx,
                                    "end": idx + kw_len,
                                    "confidence": 1.0
                                })
                            start_idx = idx + kw_len

            return entities

        return await asyncio.to_thread(_extract)

    async def extract_keyphrases(self, text: str, language: str = "en") -> List[str]:
        """Key phrase extraction using spaCy noun chunks."""
        def _extract():
            nlp = self._get_spacy_model(language)
            if nlp is None:
                return []

            doc = nlp(text[:100000])
            phrases = {}

            # Use noun chunks as key phrases
            for chunk in doc.noun_chunks:
                cleaned = chunk.text.strip().lower()
                if len(cleaned) > 2 and len(cleaned.split()) <= 5:
                    phrases[cleaned] = phrases.get(cleaned, 0) + 1

            # Sort by frequency and return top phrases
            sorted_phrases = sorted(phrases.items(), key=lambda x: x[1], reverse=True)
            return [phrase for phrase, _ in sorted_phrases[:30]]

        return await asyncio.to_thread(_extract)

    async def detect_intent(self, text: str, language: str = "en") -> Dict[str, Any]:
        """Simple rule-based intent detection (upgradeable to LLM-based with Azure OpenAI)."""
        def _detect():
            text_lower = text[:2000].lower()

            # Simple keyword-based intent detection
            intent_keywords = {
                "question": ["?", "what", "how", "why", "when", "where", "who", "which", "can you", "could you"],
                "request": ["please", "need", "want", "require", "help me", "assist"],
                "complaint": ["problem", "issue", "broken", "error", "fail", "wrong", "bad", "terrible"],
                "informational": ["report", "summary", "analysis", "data", "results", "findings"],
                "instruction": ["step", "guide", "tutorial", "instructions", "procedure", "follow"],
            }

            scores = {}
            for intent, keywords in intent_keywords.items():
                score = sum(1 for kw in keywords if kw in text_lower)
                scores[intent] = score

            if max(scores.values()) == 0:
                return {"primary": "informational", "confidence": 0.3}

            primary = max(scores, key=scores.get)
            total = sum(scores.values())
            confidence = scores[primary] / total if total > 0 else 0.3

            return {"primary": primary, "confidence": round(min(confidence, 1.0), 2)}

        return await asyncio.to_thread(_detect)

    async def summarize(self, text: str, max_length: int = 150, language: str = "en") -> str:
        """Extractive summarization using spaCy sentence scoring."""
        def _summarize():
            nlp = self._get_spacy_model(language)
            if nlp is None:
                return text[:max_length] + "..."

            doc = nlp(text[:50000])

            # Score sentences by word importance (TF-based)
            from collections import Counter
            word_freq = Counter()
            for token in doc:
                if not token.is_stop and not token.is_punct and token.is_alpha:
                    word_freq[token.lower_] += 1

            if not word_freq:
                return text[:max_length] + "..."

            max_freq = max(word_freq.values())
            for word in word_freq:
                word_freq[word] /= max_freq

            sentence_scores = {}
            for sent in doc.sents:
                score = sum(word_freq.get(token.lower_, 0) for token in sent
                           if not token.is_stop and not token.is_punct)
                sentence_scores[sent] = score

            # Pick top sentences
            sorted_sentences = sorted(sentence_scores.items(), key=lambda x: x[1], reverse=True)
            summary_sentences = []
            current_length = 0

            for sent, score in sorted_sentences:
                if current_length + len(sent.text) > max_length * 2:
                    break
                summary_sentences.append(sent)
                current_length += len(sent.text)

            # Re-order by position in original text
            summary_sentences.sort(key=lambda s: s.start)
            return " ".join(s.text.strip() for s in summary_sentences)[:max_length * 3]

        return await asyncio.to_thread(_summarize)

    async def analyze_risk(self, text: str, language: str = "en") -> List[Dict[str, Any]]:
        """Fallback rule-based risk analysis if Azure isn't configured."""
        flags = []
        lower_text = text.lower()
        if "penalty" in lower_text or "violation" in lower_text:
            flags.append({
                "category": "compliance_flag",
                "severity": "medium",
                "message": "Potential penalty or violation clause detected.",
                "confidence": 0.6
            })
        if "signature" not in lower_text and "signed" not in lower_text:
            flags.append({
                "category": "missing_field",
                "severity": "medium",
                "message": "No signature reference found.",
                "confidence": 0.5
            })
        return flags

    async def extract_structured_entities(self, text: str, language: str = "en") -> Dict[str, Any]:
        """Local structural fallback using spaCy entities plus regex extraction."""

        def _extract() -> Dict[str, Any]:
            structured = {
                "people": [],
                "organizations": [],
                "locations": [],
                "dates": [],
                "amounts": [],
                "relationships": [],
            }

            nlp = self._get_spacy_model(language)
            relationship_candidates: List[str] = []

            def _clean_fragment(value: str, max_len: int = 56) -> str:
                value = re.sub(r"\s+", " ", (value or "")).strip(" -:;,.")
                return value[:max_len]

            def _add_relationship(subject: str, relation: str, obj: str):
                subject = _clean_fragment(subject, 48)
                relation = _clean_fragment(relation, 28).replace(" ", "_")
                obj = _clean_fragment(obj, 56)
                if not subject or not relation or not obj:
                    return
                if len(subject) < 2 or len(obj) < 2:
                    return
                if subject.lower() == obj.lower():
                    return
                relationship_candidates.append(f"{subject} -> {relation} -> {obj}")

            if nlp is not None:
                doc = nlp(text[:75000])
                for ent in doc.ents:
                    label = ent.label_.upper()
                    value = ent.text.strip()
                    if label == "PERSON":
                        structured["people"].append(value)
                    elif label == "ORG":
                        structured["organizations"].append(value)
                    elif label in {"GPE", "LOC", "FAC"}:
                        structured["locations"].append(value)
                    elif label == "DATE":
                        structured["dates"].append(value)
                    elif label == "MONEY":
                        structured["amounts"].append(value)

                # Build graph-friendly triplets from sentence structure.
                for sent in doc.sents:
                    sentence = sent.text.strip()
                    if len(sentence) < 12:
                        continue
                    mentioned_entities = [ent for ent in sent.ents if ent.text.strip()]
                    if not mentioned_entities:
                        continue

                    subjects = [ent.text.strip() for ent in mentioned_entities if ent.label_.upper() in {"PERSON", "ORG", "GPE", "LOC", "FAC"}]
                    values = [ent.text.strip() for ent in mentioned_entities if ent.label_.upper() in {"MONEY", "DATE", "PERCENT", "TIME"}]
                    objects = [ent.text.strip() for ent in mentioned_entities if ent.label_.upper() in {"PERSON", "ORG", "GPE", "LOC", "FAC", "PRODUCT", "EVENT"}]

                    # Prefer the first clear action verb in the sentence.
                    verb = next(
                        (token.lemma_.lower() for token in sent if token.pos_ == "VERB" and token.lemma_ and token.lemma_.isalpha()),
                        None
                    )

                    if verb and subjects and objects:
                        obj = next((o for o in objects if o.lower() != subjects[0].lower()), None)
                        if obj:
                            _add_relationship(subjects[0], verb, obj)

                    # Capture value relationships (amount/date) explicitly.
                    if subjects and values:
                        relation = "has_value"
                        lower_sentence = sentence.lower()
                        if any(k in lower_sentence for k in ["due", "deadline", "before", "by "]):
                            relation = "due_on"
                        elif any(k in lower_sentence for k in ["pay", "payment", "invoice", "amount", "total"]):
                            relation = "payment"
                        _add_relationship(subjects[0], relation, values[0])

            structured["dates"].extend(self._extract_dates(text))
            structured["amounts"].extend(self._extract_amounts(text))

            sentences = self._split_sentences(text[:12000])
            for sentence in sentences:
                lower_sentence = sentence.lower()
                people = [p for p in structured["people"] if p in sentence][:1]
                orgs = [o for o in structured["organizations"] if o in sentence][:1]
                amounts = [a for a in structured["amounts"] if a in sentence][:1]
                dates = [d for d in structured["dates"] if d in sentence][:1]

                if not any([people, orgs, amounts, dates]):
                    continue

                if any(keyword in lower_sentence for keyword in ["pay", "payment", "invoice", "amount", "total"]):
                    actor = orgs[0] if orgs else (people[0] if people else "Document")
                    detail = amounts[0] if amounts else "payment"
                    _add_relationship(actor, "payment", detail)
                    if dates:
                        _add_relationship(actor, "due_on", dates[0])
                elif any(keyword in lower_sentence for keyword in ["due", "deadline", "submit", "sign", "approve", "review"]):
                    actor = people[0] if people else (orgs[0] if orgs else "Document")
                    if dates:
                        _add_relationship(actor, "due_on", dates[0])
                    else:
                        task = sentence[:120]
                        _add_relationship(actor, "action", task)

            structured["relationships"].extend(relationship_candidates)

            for key in structured:
                structured[key] = self._unique_nonempty(structured[key], limit=10 if key != "relationships" else 12)

            return structured

        return await asyncio.to_thread(_extract)

    async def extract_actionable_insights(self, text: str, language: str = "en") -> Dict[str, Any]:
        """Local fallback that extracts likely takeaways and action items from sentences."""
        summary = await self.summarize(text, max_length=120, language=language)

        def _extract() -> Dict[str, Any]:
            sentences = self._split_sentences(text[:15000])
            action_keywords = [
                "must", "should", "need to", "required", "action", "review", "approve",
                "sign", "submit", "send", "provide", "pay", "complete", "follow up",
                "deadline", "due", "respond",
            ]

            takeaways: List[str] = []
            action_items: List[Dict[str, Any]] = []

            if summary:
                takeaways.append(summary)

            for sentence in sentences:
                normalized = " ".join(sentence.split())
                lower_sentence = normalized.lower()
                if len(normalized) < 20:
                    continue

                due_match = re.search(
                    r"\b(?:by|before|on)\s+((?:\d{1,2}/\d{1,2}/\d{2,4})|(?:\d{4}-\d{2}-\d{2})|(?:[A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4}))",
                    normalized,
                    flags=re.IGNORECASE,
                )
                assignee_match = re.search(
                    r"\b(?:assigned to|owner|contact|attn\.?|attention)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)",
                    normalized,
                )
                is_action = any(keyword in lower_sentence for keyword in action_keywords)

                if is_action and len(action_items) < 5:
                    action_items.append({
                        "task": normalized[:220],
                        "assignee": assignee_match.group(1) if assignee_match else None,
                        "due_date": due_match.group(1) if due_match else None,
                        "status": "pending",
                    })

                if (is_action or any(token in lower_sentence for token in ["important", "invoice", "payment", "contract", "deadline"])) and len(takeaways) < 5:
                    takeaways.append(normalized[:220])

                if len(takeaways) >= 5 and len(action_items) >= 5:
                    break

            if len(takeaways) < 3:
                for sentence in sentences:
                    normalized = " ".join(sentence.split())
                    if len(normalized) >= 30:
                        takeaways.append(normalized[:220])
                    if len(takeaways) >= 5:
                        break

            return {
                "takeaways": self._unique_nonempty(takeaways, limit=5),
                "action_items": action_items[:5],
            }

        return await asyncio.to_thread(_extract)
