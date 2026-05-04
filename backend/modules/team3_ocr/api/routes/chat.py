"""
Document Chat (RAG) endpoint — vector search + Azure OpenAI for Q&A.
"""

import logging
from fastapi import APIRouter, Depends, HTTPException

from modules.team3_ocr.api.dependencies import verify_auth, get_search_provider
from modules.team3_ocr.api.schemas.chat_schemas import ChatRequest, ChatResponse, ChatSource
from modules.team3_ocr.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["Team 3 - OCR"], dependencies=[Depends(verify_auth)])


# ── Cached singleton OpenAI client (avoids httpx client-closed errors) ────────
_cached_client = None
_cached_deployment = None


def _get_openai_client():
    """Return the cached Azure OpenAI client (created once, reused forever)."""
    global _cached_client, _cached_deployment

    if _cached_client is not None:
        return _cached_client, _cached_deployment

    if (
        not settings.azure_openai_endpoint
        or not settings.azure_openai_key
        or not settings.azure_openai_deployment
    ):
        return None, None

    try:
        from openai import AzureOpenAI

        _cached_client = AzureOpenAI(
            azure_endpoint=settings.azure_openai_endpoint,
            api_key=settings.azure_openai_key,
            api_version=settings.azure_openai_api_version or "2024-12-01-preview",
        )
        _cached_deployment = settings.azure_openai_deployment
        return _cached_client, _cached_deployment
    except ImportError:
        logger.warning("openai package not installed — chat endpoint unavailable")
        return None, None


SYSTEM_PROMPT = (
    "You are a professional document assistant. Answer the user's question ONLY "
    "based on the provided context references from the document. "
    "The context comes from OCR output and may represent PDFs, scans, or image uploads. "
    "Treat OCR text as the source of truth for image documents and answer from it directly. "
    "Do not say you cannot view or interpret images when OCR context is present. "
    "If the answer cannot be found in the context, say so clearly. "
    "Be concise and cite your sources naturally (e.g., 'According to Reference 1...') "
    "within your response where relevant."
)

COMPARE_SYSTEM_PROMPT = (
    "You are a professional document assistant. The user wants to compare multiple documents. "
    "Answer using only the provided document context, and describe the main similarities and differences "
    "between the documents. Mention documents by filename or ID, and do not invent content. "
    "The provided context can come from OCR text extracted from images/scans; use it as-is. "
    "Do not claim you cannot interpret images when OCR context is available. "
    "If the answer cannot be found in the context, say so clearly."
)

COMPARE_KEYWORDS = [
    "compare",
    "comparison",
    "differences",
    "different",
    "distinguish",
    "versus",
    "vs",
    "main difference",
    "main differences",
]


def _is_compare_question(question: str) -> bool:
    q = (question or "").lower()
    return any(keyword in q for keyword in COMPARE_KEYWORDS)


@router.post("/document", response_model=ChatResponse)
async def chat_with_document(request: ChatRequest):
    """Ask a question about a specific processed document using RAG."""
    # 1. Retrieve relevant chunks from the document's vector index
    search = get_search_provider()
    
    context_chunks = []
    try:
        if request.document_ids and len(request.document_ids) > 0:
            # Batch search: Search across specific documents
            logger.info(f"Performing batch search for {len(request.document_ids)} documents")
            all_chunks = []
            for did in request.document_ids:
                chunks = await search.search_document(doc_id=did, query=request.question, top_k=8)
                # Tag chunks with doc_id if not present
                for c in chunks:
                    if 'doc_id' not in c:
                        c['doc_id'] = did
                all_chunks.extend(chunks)
            
            # Rerank and take top 12 for better context across documents
            context_chunks = sorted(all_chunks, key=lambda x: x.get("score", 0), reverse=True)[:12]
            
        elif not request.document_id or request.document_id == "all":
            # Global search
            logger.info("Performing global search across all documents")
            context_chunks = await search.search(
                query=request.question,
                top_k=10,
            )
        else:
            # Single document search
            logger.info(f"Performing single-document search for {request.document_id}")
            context_chunks = await search.search_document(
                doc_id=request.document_id,
                query=request.question,
                top_k=6,
            )
    except Exception as e:
        logger.error(f"Search failed during RAG process: {e}")
        # Fallback to empty context if search provider crashes
        context_chunks = []

    if not context_chunks:
        # Check if the document actually exists in the store to provide better error
        is_indexed = False
        if request.document_id and request.document_id != "all":
            # Simple check if doc exists in store
            from modules.team3_ocr.providers.local.search_provider import LocalSearchProvider
            if isinstance(search, LocalSearchProvider):
                is_indexed = request.document_id in search._documents
        
        if is_indexed:
            msg = "I found the document, but I couldn't find any specific sections that match your question. Try rephrasing your search."
        else:
            msg = "I couldn't find any indexed content for the requested document(s). Please ensure they have been processed and indexed first."
            
        return ChatResponse(
            answer=msg,
            sources=[],
        )

    # 2. Build the context block from retrieved chunks
    context_block = ""
    for i, c in enumerate(context_chunks):
        doc_info = ""
        if 'doc_id' in c:
            # Try to find filename if available in metadata
            from modules.team3_ocr.providers.local.search_provider import LocalSearchProvider
            if isinstance(search, LocalSearchProvider) and c['doc_id'] in search._documents:
                meta = search._documents[c['doc_id']].get("metadata", {})
                doc_name = meta.get('filename', c['doc_id'])
                doc_info = f" Document: {doc_name} (ID: {c['doc_id']})"
            else:
                doc_info = f" Document ID: {c['doc_id']}"

        context_block += (
            f"[Reference {i+1}]{doc_info} (Confidence: {c.get('score', 1.0)}):\n"
            f"{c['text_snippet']}\n\n"
        )

    # 3. Get the Azure OpenAI client
    client, deployment = _get_openai_client()

    if client is None:
        # Graceful fallback — return the raw context snippets as the answer
        fallback_text = (
            "Azure OpenAI is not configured, so I cannot generate a conversational answer. "
            "However, here are the most relevant snippets from your document:\n\n"
        )
        for i, c in enumerate(context_chunks):
            fallback_text += f"**Snippet {i+1}** (score: {c['score']}):\n{c['text_snippet'][:400]}\n\n"
        return ChatResponse(
            answer=fallback_text.strip(),
            sources=[
                ChatSource(text_snippet=c["text_snippet"][:300], score=c["score"])
                for c in context_chunks
            ],
        )

    # 4. Build messages for OpenAI
    system_prompt = COMPARE_SYSTEM_PROMPT if _is_compare_question(request.question) else SYSTEM_PROMPT
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "system", "content": f"Document context:\n{context_block}"},
    ]

    # Add conversation history (last 10 turns max)
    for msg in request.history[-10:]:
        messages.append({"role": msg.role, "content": msg.content})

    # Add the current question
    messages.append({"role": "user", "content": request.question})

    # 5. Call Azure OpenAI
    try:
        import asyncio

        def _call_openai():
            response = client.chat.completions.create(
                model=deployment,
                temperature=0.2,
                max_tokens=1024,
                messages=messages,
            )
            return response.choices[0].message.content or "No response generated."

        answer = await asyncio.to_thread(_call_openai)
    except Exception as e:
        logger.error(f"Azure OpenAI chat failed: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Failed to get response from Azure OpenAI: {str(e)}",
        )

    return ChatResponse(
        answer=answer,
        sources=[
            ChatSource(text_snippet=c["text_snippet"][:300], score=c["score"])
            for c in context_chunks
        ],
    )
