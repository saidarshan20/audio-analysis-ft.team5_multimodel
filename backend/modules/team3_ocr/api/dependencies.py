"""
Shared FastAPI dependencies — auth middleware, provider injection, etc.
Auth is disabled by default. Flip AUTH_ENABLED=true in .env to enable.
"""

from fastapi import Header, HTTPException, Depends
from modules.team3_ocr.config import settings
from modules.team3_ocr.providers.base import OCRProviderBase, NLPProviderBase, SearchProviderBase
from modules.team3_ocr.providers.azure import AzureOCRProvider, AzureNLPProvider
from modules.team3_ocr.providers.local import LocalOCRProvider, LocalNLPProvider, LocalSearchProvider
from modules.team3_ocr.storage import BlobStorageClient

# ===== Singleton provider instances =====
_ocr_provider = None
_nlp_provider = None
_search_provider = None
_blob_storage = None


def get_ocr_provider() -> OCRProviderBase:
    """Get the configured OCR provider (local or azure)."""
    global _ocr_provider
    if _ocr_provider is None:
        if settings.ocr_provider == "azure":
            _ocr_provider = AzureOCRProvider(
                endpoint=settings.azure_document_intelligence_endpoint,
                key=settings.azure_document_intelligence_key,
            )
        else:
            _ocr_provider = LocalOCRProvider()
    return _ocr_provider


def get_nlp_provider() -> NLPProviderBase:
    """Get the configured NLP provider."""
    global _nlp_provider
    if _nlp_provider is None:
        if settings.nlp_provider == "azure":
            _nlp_provider = AzureNLPProvider(
                endpoint=settings.azure_openai_endpoint,
                key=settings.azure_openai_key,
                deployment=settings.azure_openai_deployment,
                api_version=settings.azure_openai_api_version,
            )
        else:
            _nlp_provider = LocalNLPProvider()
    return _nlp_provider


def get_search_provider() -> SearchProviderBase:
    """Get the configured search provider."""
    global _search_provider
    if _search_provider is None:
        if settings.search_provider == "azure":
            raise NotImplementedError("Azure Search provider not yet implemented. Set SEARCH_PROVIDER=local")
        else:
            _search_provider = LocalSearchProvider()
    return _search_provider


def get_blob_storage() -> BlobStorageClient:
    """Get a singleton Blob storage client (only used when STORAGE_PROVIDER=azure)."""
    global _blob_storage
    if _blob_storage is None:
        _blob_storage = BlobStorageClient()
    return _blob_storage


# ===== Auth Middleware =====

async def verify_auth(authorization: str = Header(default=None)):
    """
    Authentication middleware — currently a no-op.
    When AUTH_ENABLED=true, this will validate the token.

    To add auth later:
    1. Set AUTH_ENABLED=true in .env
    2. Implement token validation below (JWT, Azure AD, etc.)
    """
    if settings.auth_enabled:
        if not authorization:
            raise HTTPException(
                status_code=401,
                detail="Authentication required. Provide Authorization header.",
            )
        # ------------------------------------------------
        # TODO: Add your auth logic here when ready
        # Example for JWT:
        #   token = authorization.replace("Bearer ", "")
        #   payload = jwt.decode(token, settings.auth_secret_key, algorithms=[settings.auth_algorithm])
        #
        # Example for Azure AD:
        #   validate_azure_ad_token(authorization)
        # ------------------------------------------------
        pass
    # Auth disabled — allow all requests
    return True
