"""
Azure NLP provider using Azure OpenAI for generative insights.
"""

import asyncio
import json
from typing import Any, Dict, List, Optional

from modules.team3_ocr.providers.base import NLPProviderBase
from modules.team3_ocr.providers.local.nlp_provider import LocalNLPProvider


class AzureNLPProvider(NLPProviderBase):
    """
    Hybrid NLP provider.

    - Azure OpenAI powers summarization and intent classification
    - Local NLP remains the fallback for language, sentiment, entities, and keyphrases
    """

    def __init__(
        self,
        endpoint: Optional[str],
        key: Optional[str],
        deployment: Optional[str],
        api_version: Optional[str],
    ):
        self._local = LocalNLPProvider()

        if not endpoint or not key or not deployment or not api_version:
            raise ValueError(
                "Azure NLP provider requires AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, "
                "AZURE_OPENAI_DEPLOYMENT, and AZURE_OPENAI_API_VERSION."
            )

        try:
            from openai import AzureOpenAI
        except ImportError as exc:
            raise RuntimeError(
                "Azure NLP provider requires the 'openai' package. "
                "Install backend dependencies and restart the server."
            ) from exc

        self._client = AzureOpenAI(
            azure_endpoint=endpoint,
            api_key=key,
            api_version=api_version,
        )
        self._deployment = deployment

    async def detect_language(self, text: str) -> Dict[str, Any]:
        return await self._local.detect_language(text)

    async def analyze_sentiment(self, text: str, language: str = "en") -> Dict[str, Any]:
        return await self._local.analyze_sentiment(text, language)

    async def extract_entities(self, text: str, language: str = "en", custom_entities: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
        return await self._local.extract_entities(text, language, custom_entities=custom_entities)

    async def extract_keyphrases(self, text: str, language: str = "en") -> List[str]:
        return await self._local.extract_keyphrases(text, language)

    async def detect_intent(self, text: str, language: str = "en") -> Dict[str, Any]:
        return await asyncio.to_thread(self._detect_intent_sync, text, language)

    async def summarize(self, text: str, max_length: int = 150, language: str = "en") -> str:
        return await asyncio.to_thread(self._summarize_sync, text, max_length, language)

    async def analyze_risk(self, text: str, language: str = "en") -> List[Dict[str, Any]]:
        return await asyncio.to_thread(self._analyze_risk_sync, text, language)

    async def extract_structured_entities(self, text: str, language: str = "en") -> Dict[str, Any]:
        return await asyncio.to_thread(self._extract_structured_entities_sync, text, language)

    async def extract_actionable_insights(self, text: str, language: str = "en") -> Dict[str, Any]:
        return await asyncio.to_thread(self._extract_action_sync, text, language)

    def _detect_intent_sync(self, text: str, language: str) -> Dict[str, Any]:
        prompt = (
            "Classify the user's primary intent from the text. "
            "Return compact JSON only with keys: primary, confidence. "
            "Primary should be one of: question, request, complaint, informational, instruction. "
            "Confidence should be a number between 0 and 1."
        )
        sample = text[:4000]

        try:
            response = self._client.chat.completions.create(
                model=self._deployment,
                temperature=0,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": sample},
                ],
            )
            content = response.choices[0].message.content or "{}"
            parsed = json.loads(content)
            primary = str(parsed.get("primary", "informational")).strip().lower() or "informational"
            confidence = float(parsed.get("confidence", 0.5))
            confidence = max(0.0, min(confidence, 1.0))
            return {"primary": primary, "confidence": round(confidence, 2)}
        except Exception:
            return self._run_local_intent(sample, language)

    def _summarize_sync(self, text: str, max_length: int, language: str) -> str:
        prompt = (
            "Summarize the document clearly and concisely for a business user. "
            f"Target about {max_length} words. Preserve the main facts, actions, and conclusions."
        )
        sample = text[:12000]

        try:
            response = self._client.chat.completions.create(
                model=self._deployment,
                temperature=0.2,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": sample},
                ],
            )
            content = response.choices[0].message.content or ""
            return content.strip() or self._run_local_summary(sample, max_length, language)
        except Exception:
            return self._run_local_summary(sample, max_length, language)

    def _analyze_risk_sync(self, text: str, language: str) -> List[Dict[str, Any]]:
        prompt = (
            "Analyze the document for risk and compliance issues. "
            "Identify missing critical fields (e.g., signatures, dates), suspicious values, or outlier clauses. "
            "Respond in JSON format as a list under the key 'flags'. Each item must have: "
            "'category' (missing_field, suspicious_value, compliance_flag), 'severity' (high, medium, low), "
            "'message' (string describing the risk), 'confidence' (0.0 to 1.0)."
        )
        sample = text[:8000]
        try:
            response = self._client.chat.completions.create(
                model=self._deployment,
                temperature=0.1,
                response_format={"type": "json_object"},
                messages=[{"role": "system", "content": prompt}, {"role": "user", "content": sample}],
            )
            content = response.choices[0].message.content or "{}"
            return json.loads(content).get("flags", [])
        except Exception:
            return asyncio.run(self._local.analyze_risk(sample, language))

    def _extract_structured_entities_sync(self, text: str, language: str) -> Dict[str, Any]:
        prompt = (
            "Extract organized entities and relationships. Return JSON with these exact arrays: "
            "'people', 'organizations', 'locations', 'dates', 'amounts', 'relationships'. "
            "For 'relationships', output concise graph triplets only in this format: "
            "'subject -> relation -> object'. "
            "Use short relation verbs like 'pays', 'approved_by', 'due_on', 'belongs_to', 'assigned_to'. "
            "Do not output full sentences, explanations, or numeric-only nodes as subjects."
        )
        sample = text[:8000]
        try:
            response = self._client.chat.completions.create(
                model=self._deployment,
                temperature=0.1,
                response_format={"type": "json_object"},
                messages=[{"role": "system", "content": prompt}, {"role": "user", "content": sample}],
            )
            content = response.choices[0].message.content or "{}"
            data = json.loads(content)
            return {
                "people": data.get("people", []),
                "organizations": data.get("organizations", []),
                "locations": data.get("locations", []),
                "dates": data.get("dates", []),
                "amounts": data.get("amounts", []),
                "relationships": data.get("relationships", [])
            }
        except Exception:
            return asyncio.run(self._local.extract_structured_entities(sample, language))

    def _extract_action_sync(self, text: str, language: str) -> Dict[str, Any]:
        prompt = (
            "Extract critical takeaways and action items. Return JSON with two keys: "
            "'takeaways' (list of strings, top 5 highlights), and 'action_items' (list of objects). "
            "Action item objects must have: 'task' (string), 'assignee' (string or null), 'due_date' (string or null), 'status' (pending/completed)."
        )
        sample = text[:8000]
        try:
            response = self._client.chat.completions.create(
                model=self._deployment,
                temperature=0.2,
                response_format={"type": "json_object"},
                messages=[{"role": "system", "content": prompt}, {"role": "user", "content": sample}],
            )
            content = response.choices[0].message.content or "{}"
            data = json.loads(content)
            return {
                "takeaways": data.get("takeaways", []),
                "action_items": data.get("action_items", [])
            }
        except Exception:
            return asyncio.run(self._local.extract_actionable_insights(sample, language))

    def _run_local_intent(self, text: str, language: str) -> Dict[str, Any]:
        return asyncio.run(self._local.detect_intent(text, language))

    def _run_local_summary(self, text: str, max_length: int, language: str) -> str:
        return asyncio.run(self._local.summarize(text, max_length=max_length, language=language))
