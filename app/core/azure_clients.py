from openai import AsyncAzureOpenAI
from azure.ai.documentintelligence.aio import DocumentIntelligenceClient
from azure.core.credentials import AzureKeyCredential

from app.core.config import get_settings

_openai_client: AsyncAzureOpenAI | None = None
_doc_intel_client: DocumentIntelligenceClient | None = None


def get_openai_client() -> AsyncAzureOpenAI:
    global _openai_client
    if _openai_client is None:
        s = get_settings()
        _openai_client = AsyncAzureOpenAI(
            azure_endpoint=s.azure_openai_endpoint,
            api_key=s.azure_openai_api_key,
            api_version=s.azure_openai_api_version,
        )
    return _openai_client


def get_doc_intelligence_client() -> DocumentIntelligenceClient:
    global _doc_intel_client
    if _doc_intel_client is None:
        s = get_settings()
        _doc_intel_client = DocumentIntelligenceClient(
            endpoint=s.azure_doc_intelligence_endpoint,
            credential=AzureKeyCredential(s.azure_doc_intelligence_key),
        )
    return _doc_intel_client
