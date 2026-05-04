"""
Text Analytics endpoints — sentiment, NER, keyphrases, language, intent, summarization.
Entity editing (user corrections) is also handled here.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from modules.team3_ocr.api.dependencies import verify_auth, get_nlp_provider
from modules.team3_ocr.api.schemas.analytics_schemas import (
    AnalyzeRequest, SentimentRequest, EntitiesRequest, KeyphrasesRequest,
    LanguageRequest, IntentRequest, SummarizeRequest, EntityUpdateRequest,
    FullAnalysisResponse, SentimentResult, EntityResult, LanguageResult, IntentResult,
    RiskFlag, StructuredEntities, ActionItem, InsightsResult,
)
from modules.team3_ocr.models.database import get_db
from modules.team3_ocr.models.document import OCRResult, Entity, AnalyticsResult

router = APIRouter(prefix="/analytics", tags=["Team 3 - OCR"], dependencies=[Depends(verify_auth)])


async def _get_text_for_document(doc_id: str, db: AsyncSession) -> str:
    """Helper: get concatenated OCR text for a document."""
    results = (await db.execute(
        select(OCRResult).where(OCRResult.document_id == doc_id).order_by(OCRResult.page_number)
    )).scalars().all()
    if not results:
        raise HTTPException(404, f"No OCR results found for document {doc_id}")
    return "\n".join(r.extracted_text or "" for r in results)


@router.post("/analyze", response_model=FullAnalysisResponse)
async def full_analysis(request: AnalyzeRequest, db: AsyncSession = Depends(get_db)):
    """Run the full NLP analysis pipeline on text or a document."""
    # Get text from direct input or document
    if request.text:
        text = request.text
        doc_id = None
    elif request.document_id:
        text = await _get_text_for_document(request.document_id, db)
        doc_id = request.document_id
    else:
        raise HTTPException(400, "Provide either 'text' or 'document_id'")

    nlp = get_nlp_provider()
    response = FullAnalysisResponse(document_id=doc_id)

    # Detect language first (used by other analyses)
    detected_lang = "en"
    if "language" in request.analyses:
        lang = await nlp.detect_language(text[:5000])
        response.language = LanguageResult(**lang)
        detected_lang = lang.get("code", "en")

    # Run requested analyses
    if "sentiment" in request.analyses:
        sentiment = await nlp.analyze_sentiment(text, detected_lang)
        response.sentiment = SentimentResult(**sentiment)

    if "ner" in request.analyses:
        custom_entities_dict = [ce.model_dump() for ce in request.custom_entities] if request.custom_entities else None
        entities = await nlp.extract_entities(text, detected_lang, custom_entities=custom_entities_dict)
        response.entities = [EntityResult(
            id=f"temp-{i}",
            text=e["text"],
            entity_type=e["type"],
            start_offset=e.get("start"),
            end_offset=e.get("end"),
            confidence=e.get("confidence"),
        ) for i, e in enumerate(entities)]

        # If analyzing a document, save entities to DB
        if doc_id:
            for ent in entities:
                entity = Entity(
                    document_id=doc_id,
                    text=ent["text"],
                    entity_type=ent["type"],
                    start_offset=ent.get("start"),
                    end_offset=ent.get("end"),
                    confidence=ent.get("confidence"),
                )
                db.add(entity)

    if "keyphrases" in request.analyses:
        response.keyphrases = await nlp.extract_keyphrases(text, detected_lang)

    if "intent" in request.analyses:
        intent = await nlp.detect_intent(text, detected_lang)
        response.intent = IntentResult(**intent)

    if "summary" in request.analyses or "summarize" in request.analyses:
        response.summary = await nlp.summarize(text, language=detected_lang)

    if "risk" in request.analyses:
        response.risk_flags = [RiskFlag(**r) for r in await nlp.analyze_risk(text, language=detected_lang)]

    if "structured_entities" in request.analyses:
        structs = await nlp.extract_structured_entities(text, language=detected_lang)
        response.structured_entities = StructuredEntities(**structs)

    if "insights" in request.analyses or "actions" in request.analyses:
        insights_data = await nlp.extract_actionable_insights(text, language=detected_lang)
        
        takeaways = insights_data.get("takeaways", [])
        actions_raw = insights_data.get("action_items", [])
        
        action_items = [ActionItem(**a) for a in actions_raw if isinstance(a, dict)]
        
        response.insights = InsightsResult(
            summary=response.summary or "No summary generated.",
            takeaways=takeaways,
            action_items=action_items
        )

    # Save analytics result if document-based
    if doc_id:
        analytics = AnalyticsResult(
            document_id=doc_id,
            sentiment=response.sentiment.model_dump() if response.sentiment else None,
            keyphrases=response.keyphrases if response.keyphrases else None,
            language=response.language.model_dump() if response.language else None,
            intent=response.intent.model_dump() if response.intent else None,
            summary=response.summary,
        )
        db.add(analytics)
        await db.commit()

    return response


@router.post("/sentiment", response_model=SentimentResult)
async def analyze_sentiment(request: SentimentRequest):
    """Sentiment analysis on provided text."""
    nlp = get_nlp_provider()
    result = await nlp.analyze_sentiment(request.text)
    return SentimentResult(**result)


@router.post("/entities", response_model=list[EntityResult])
async def extract_entities(request: EntitiesRequest):
    """Named Entity Recognition on provided text."""
    nlp = get_nlp_provider()
    custom_entities_dict = [ce.model_dump() for ce in request.custom_entities] if request.custom_entities else None
    entities = await nlp.extract_entities(request.text, custom_entities=custom_entities_dict)
    return [EntityResult(
        id=f"temp-{i}",
        text=e["text"],
        entity_type=e["type"],
        start_offset=e.get("start"),
        end_offset=e.get("end"),
        confidence=e.get("confidence"),
    ) for i, e in enumerate(entities)]


@router.post("/keyphrases", response_model=list[str])
async def extract_keyphrases(request: KeyphrasesRequest):
    """Key phrase extraction from text."""
    nlp = get_nlp_provider()
    return await nlp.extract_keyphrases(request.text)


@router.post("/language", response_model=LanguageResult)
async def detect_language(request: LanguageRequest):
    """Detect the language of the provided text."""
    nlp = get_nlp_provider()
    result = await nlp.detect_language(request.text)
    return LanguageResult(**result)


@router.post("/intent", response_model=IntentResult)
async def detect_intent(request: IntentRequest):
    """Detect the intent of the provided text."""
    nlp = get_nlp_provider()
    result = await nlp.detect_intent(request.text)
    return IntentResult(**result)


@router.post("/summarize")
async def summarize_text(request: SummarizeRequest):
    """Summarize the provided text."""
    nlp = get_nlp_provider()
    summary = await nlp.summarize(request.text, max_length=request.max_length)
    return {"summary": summary}


# ===== Entity Editing =====

@router.get("/entities/{doc_id}", response_model=list[EntityResult])
async def get_document_entities(doc_id: str, db: AsyncSession = Depends(get_db)):
    """Get all entities for a document (including user-edited ones)."""
    entities = (await db.execute(
        select(Entity).where(Entity.document_id == doc_id)
    )).scalars().all()

    return [EntityResult(
        id=e.id,
        text=e.text,
        entity_type=e.entity_type,
        start_offset=e.start_offset,
        end_offset=e.end_offset,
        confidence=e.confidence,
        is_user_edited=e.is_user_edited,
    ) for e in entities]


@router.put("/entities/{doc_id}/{entity_id}", response_model=EntityResult)
async def update_entity(
    doc_id: str,
    entity_id: str,
    update: EntityUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Edit a detected entity — correct its text or type."""
    entity = await db.get(Entity, entity_id)
    if not entity or entity.document_id != doc_id:
        raise HTTPException(404, "Entity not found")

    if update.text is not None:
        entity.text = update.text
    if update.entity_type is not None:
        entity.entity_type = update.entity_type
    entity.is_user_edited = True
    await db.commit()
    await db.refresh(entity)

    return EntityResult(
        id=entity.id,
        text=entity.text,
        entity_type=entity.entity_type,
        start_offset=entity.start_offset,
        end_offset=entity.end_offset,
        confidence=entity.confidence,
        is_user_edited=entity.is_user_edited,
    )


@router.delete("/entities/{doc_id}/{entity_id}")
async def delete_entity(doc_id: str, entity_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a detected entity."""
    entity = await db.get(Entity, entity_id)
    if not entity or entity.document_id != doc_id:
        raise HTTPException(404, "Entity not found")

    await db.delete(entity)
    await db.commit()
    return {"success": True, "message": f"Entity {entity_id} deleted"}
