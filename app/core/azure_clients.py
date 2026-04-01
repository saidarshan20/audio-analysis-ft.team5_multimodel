from groq import AsyncGroq
from app.core.config import get_settings

_groq_client: AsyncGroq | None = None


def get_groq_client() -> AsyncGroq:
    global _groq_client
    if _groq_client is None:
        s = get_settings()
        _groq_client = AsyncGroq(api_key=s.groq_api_key)
    return _groq_client
