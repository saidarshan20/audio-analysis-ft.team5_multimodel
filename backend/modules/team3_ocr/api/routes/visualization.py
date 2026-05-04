"""
Visualization endpoints - word cloud, frequency distribution, linguistic analysis.
"""

import uuid
import asyncio
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from modules.team3_ocr.config import settings
from modules.team3_ocr.api.dependencies import verify_auth, get_nlp_provider, get_blob_storage
from modules.team3_ocr.api.schemas.visualization_schemas import (
    WordCloudRequest, FrequencyRequest, LinguisticRequest, KnowledgeGraphRequest,
    WordCloudResponse, FrequencyResponse, LinguisticResponse, KnowledgeGraphResponse, WordFrequencyItem,
)
from modules.team3_ocr.models.database import get_db
from modules.team3_ocr.models.document import OCRResult
from modules.team3_ocr.providers.local.nlp_provider import SPACY_MODELS
from modules.team3_ocr.storage import BlobPaths

router = APIRouter(prefix="/viz", tags=["Team 3 - OCR"], dependencies=[Depends(verify_auth)])

VIZ_OUTPUT_DIR = Path(settings.output_dir) / "visualizations"
VIZ_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


async def _resolve_text(text: str = None, document_id: str = None, db: AsyncSession = None) -> str:
    """Get text from direct input or document."""
    if text:
        return text
    if document_id and db:
        results = (await db.execute(
            select(OCRResult).where(OCRResult.document_id == document_id).order_by(OCRResult.page_number)
        )).scalars().all()
        if results:
            return "\n".join(r.extracted_text or "" for r in results)
    raise HTTPException(400, "Provide either 'text' or 'document_id'")


@router.post("/wordcloud", response_model=WordCloudResponse)
async def generate_wordcloud(request: WordCloudRequest, db: AsyncSession = Depends(get_db)):
    """Generate a word cloud image from text."""
    text = await _resolve_text(request.text, request.document_id, db)

    def _generate():
        try:
            from wordcloud import WordCloud
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            import re

            # Strip out HTML-like tags emitted in OCR table text.
            clean_text = re.sub(r'<[^>]+>', ' ', text)
            # Strip loose markdown table separators that become noise.
            clean_text = re.sub(r'(\||\-)', ' ', clean_text)

            wc = WordCloud(
                width=request.width,
                height=request.height,
                max_words=request.max_words,
                background_color="white",
                colormap="viridis",
            ).generate(clean_text)

            image_id = str(uuid.uuid4())
            image_path = VIZ_OUTPUT_DIR / f"{image_id}_wordcloud.png"

            plt.figure(figsize=(request.width / 100, request.height / 100))
            plt.imshow(wc, interpolation="bilinear")
            plt.axis("off")
            plt.tight_layout(pad=0)
            plt.savefig(image_path, dpi=100, bbox_inches="tight", pad_inches=0)
            plt.close()

            word_freq = wc.words_
            data = [
                {"text": word, "frequency": int(freq * 100)}
                for word, freq in sorted(word_freq.items(), key=lambda x: x[1], reverse=True)[:50]
            ]

            return str(image_path), image_id, data
        except Exception as e:
            raise ValueError(f"Word cloud generation failed: {e}")

    try:
        image_path, image_id, data = await asyncio.to_thread(_generate)
    except ValueError as e:
        raise HTTPException(500, str(e))

    import base64
    image_b64 = None
    image_bytes = None
    try:
        with open(image_path, "rb") as f:
            image_bytes = f.read()
            image_b64 = "data:image/png;base64," + base64.b64encode(image_bytes).decode()
    except Exception:
        pass

    if settings.storage_provider == "azure" and image_bytes:
        blob = get_blob_storage()
        if blob.is_available():
            paths = BlobPaths()
            blob.upload_bytes(paths.viz_blob_name(f"{image_id}_wordcloud.png"), image_bytes, content_type="image/png")

    return WordCloudResponse(
        image_url=f"/team3_ocr/api/v1/viz/images/{image_id}_wordcloud.png",
        image_base64=image_b64,
        data=[WordFrequencyItem(**d) for d in data],
    )


@router.post("/frequency", response_model=FrequencyResponse)
async def word_frequency(request: FrequencyRequest, db: AsyncSession = Depends(get_db)):
    """Get word frequency distribution data (for frontend charting)."""
    text = await _resolve_text(request.text, request.document_id, db)

    def _analyze():
        from collections import Counter
        import re

        clean_text = re.sub(r'<[^>]+>', ' ', text)
        words = re.findall(r'\b[a-zA-Z]{3,}\b', clean_text.lower())

        stop_words = {
            "the", "and", "for", "that", "this", "with", "are", "was", "were",
            "been", "being", "have", "has", "had", "not", "but", "from", "they",
            "will", "would", "could", "should", "can", "may", "might", "shall",
            "its", "his", "her", "our", "their", "your", "all", "each", "every",
            "some", "any", "few", "more", "most", "other", "into", "over",
        }
        words = [w for w in words if w not in stop_words]

        freq = Counter(words).most_common(request.top_n)
        return [{"text": word, "frequency": count} for word, count in freq]

    data = await asyncio.to_thread(_analyze)

    return FrequencyResponse(
        data=[WordFrequencyItem(**d) for d in data],
    )


@router.post("/linguistic", response_model=LinguisticResponse)
async def linguistic_analysis(request: LinguisticRequest, db: AsyncSession = Depends(get_db)):
    """Part-of-speech distribution and linguistic analysis."""
    text = await _resolve_text(request.text, request.document_id, db)
    nlp_provider = get_nlp_provider()

    detected_lang = "en"
    try:
        language_result = await nlp_provider.detect_language(text[:5000])
        detected_lang = (language_result or {}).get("code", "en").lower()
    except Exception:
        detected_lang = "en"

    def _analyze():
        resolved_lang = detected_lang if detected_lang in SPACY_MODELS else "en"
        model_name = SPACY_MODELS.get(resolved_lang, "en_core_web_sm")

        try:
            import spacy
            nlp = spacy.load(model_name)
        except Exception as exc:
            return {
                "pos_distribution": {},
                "language_code": resolved_lang,
                "error_message": f"spaCy model '{model_name}' is unavailable: {exc}",
            }

        doc = nlp(text[:50000])
        from collections import Counter

        pos_counts = Counter(token.pos_ for token in doc if not token.is_punct and not token.is_space)

        pos_labels = {
            "NOUN": "Nouns", "VERB": "Verbs", "ADJ": "Adjectives", "ADV": "Adverbs",
            "PROPN": "Proper Nouns", "DET": "Determiners", "ADP": "Prepositions",
            "PRON": "Pronouns", "CONJ": "Conjunctions", "NUM": "Numbers",
            "AUX": "Auxiliary Verbs", "PART": "Particles", "INTJ": "Interjections",
            "CCONJ": "Coord. Conjunctions", "SCONJ": "Subord. Conjunctions",
        }

        distribution = {pos_labels.get(pos, pos): count for pos, count in pos_counts.most_common()}

        if not distribution:
            return {
                "pos_distribution": {},
                "language_code": resolved_lang,
                "error_message": "No part-of-speech data could be extracted from the provided text.",
            }

        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt

            image_id = str(uuid.uuid4())
            image_path = VIZ_OUTPUT_DIR / f"{image_id}_linguistic.png"

            labels = list(distribution.keys())[:12]
            values = [distribution[l] for l in labels]

            fig, ax = plt.subplots(figsize=(10, 6))
            ax.barh(labels, values, color=plt.cm.viridis([i / len(labels) for i in range(len(labels))]))
            ax.set_xlabel("Count")
            ax.set_title("Part-of-Speech Distribution")
            plt.tight_layout()
            plt.savefig(image_path, dpi=100, bbox_inches="tight")
            plt.close()

            return {
                "pos_distribution": distribution,
                "image_url": f"/team3_ocr/api/v1/viz/images/{image_id}_linguistic.png",
                "language_code": resolved_lang,
            }
        except Exception as exc:
            return {
                "pos_distribution": distribution,
                "image_url": None,
                "language_code": resolved_lang,
                "error_message": f"Chart rendering unavailable: {exc}",
            }

    result = await asyncio.to_thread(_analyze)

    import base64
    if result.get("image_url"):
        img_path = VIZ_OUTPUT_DIR / Path(result["image_url"]).name
        try:
            with open(img_path, "rb") as f:
                image_bytes = f.read()
                result["image_base64"] = "data:image/png;base64," + base64.b64encode(image_bytes).decode()

            if settings.storage_provider == "azure":
                blob = get_blob_storage()
                if blob.is_available():
                    paths = BlobPaths()
                    blob.upload_bytes(paths.viz_blob_name(img_path.name), image_bytes, content_type="image/png")
        except Exception:
            pass

    return LinguisticResponse(**result)


@router.post("/knowledge-graph", response_model=KnowledgeGraphResponse)
async def knowledge_graph(request: KnowledgeGraphRequest):
    """Generate a knowledge graph using NetworkX and optional GraphRAG-style triplets."""
    relationships = [r.strip() for r in (request.relationships or []) if isinstance(r, str) and r.strip()]
    if not relationships:
        return KnowledgeGraphResponse(error_message="No relationships provided.")
    engine = (request.engine or "hybrid").lower()
    if engine not in {"networkx", "graphrag", "hybrid"}:
        engine = "hybrid"

    def _generate():
        try:
            import re
            import textwrap
            from collections import defaultdict
            import networkx as nx
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt

            g = nx.DiGraph()
            edge_value_labels = {}
            edge_relation_labels = {}
            relation_nodes = set()
            generic_noise = {
                "document", "text", "summary", "details", "data", "record", "records", "item", "items",
                "value", "values", "metric", "metrics", "number", "numbers", "result", "results", "status",
            }

            def _is_numericish(token: str) -> bool:
                token = token.strip().replace(",", "")
                return bool(re.fullmatch(r"[$€£]?\d+(?:\.\d+)?%?", token))

            def _clean_label(token: str) -> str:
                token = re.sub(r"\s+", " ", token).strip()
                token = re.sub(r"^[\-\*\u2022\.\:]+", "", token).strip()
                token = token.strip("'\"")
                token = re.sub(r"^Region\s*\(", "Region: ", token)
                token = token.replace(")", "")
                return token[:48]

            def _is_noise_node(token: str) -> bool:
                stripped = _clean_label(token)
                lowered = stripped.lower()
                if not stripped or len(stripped) < 2:
                    return True
                if lowered in generic_noise:
                    return True
                if lowered.startswith(("table ", "figure ", "page ", "section ")):
                    return True
                if lowered in {"n/a", "na", "none", "unknown"}:
                    return True
                return False

            def _normalize_relation(relation: str) -> str:
                relation = _clean_label(relation).lower()
                relation = relation.replace("&", " and ")
                relation = re.sub(r"[^a-z0-9_ ]+", "", relation)
                relation = re.sub(r"\s+", "_", relation).strip("_")
                return relation[:28] or "related_to"

            def _parse_parts(rel: str):
                rel = (rel or "").strip()
                if not rel:
                    return []
                if re.search(r"(?:->|→|=>|⟶)", rel):
                    return [_clean_label(p) for p in re.split(r"\s*(?:->|→|=>|⟶)\s*", rel) if p.strip()]

                colon_match = re.match(r"^([^:]{2,60})\s*:\s*([^:]{2,80})$", rel)
                if colon_match:
                    return [_clean_label(colon_match.group(1)), "has_value", _clean_label(colon_match.group(2))]

                sentence_match = re.match(
                    r"^(.{2,60}?)\s+(is|are|was|were|has|have|contains|includes|assigned to|belongs to|approved by|due on|paid to)\s+(.{2,90})$",
                    rel,
                    flags=re.IGNORECASE,
                )
                if sentence_match:
                    return [
                        _clean_label(sentence_match.group(1)),
                        _normalize_relation(sentence_match.group(2)),
                        _clean_label(sentence_match.group(3)),
                    ]

                return [_clean_label(rel)]

            def _add_weighted_edge(src: str, dst: str):
                if not src or not dst or src == dst:
                    return
                if g.has_edge(src, dst):
                    g[src][dst]["weight"] = g[src][dst].get("weight", 1) + 1
                else:
                    g.add_edge(src, dst, weight=1)

            if engine == "networkx":
                for rel in relationships:
                    parts = _parse_parts(rel)
                    if len(parts) < 2:
                        continue
                    if len(parts) >= 3 and _is_numericish(parts[-1]):
                        src, dst, val = parts[-3], parts[-2], parts[-1]
                        if _is_noise_node(src) or _is_noise_node(dst):
                            continue
                        _add_weighted_edge(src, dst)
                        edge_value_labels.setdefault((src, dst), set()).add(val)
                        continue
                    for i in range(len(parts) - 1):
                        src, dst = parts[i], parts[i + 1]
                        if _is_noise_node(src) or _is_noise_node(dst):
                            continue
                        _add_weighted_edge(src, dst)
            else:
                triples = []
                for rel in relationships:
                    parts = _parse_parts(rel)
                    if len(parts) < 2:
                        continue
                    if len(parts) == 2:
                        subject, obj = parts[0], parts[1]
                        relation = "related_to"
                    else:
                        subject, obj = parts[0], parts[-1]
                        relation = _normalize_relation(" -> ".join(parts[1:-1]).strip() or "related_to")
                    triples.append((subject, relation[:28], obj))

                seen = set()
                for subject, relation, obj in triples:
                    key = (subject, relation, obj)
                    if key in seen:
                        continue
                    seen.add(key)

                    if _is_noise_node(subject) or _is_noise_node(obj):
                        continue

                    if _is_numericish(obj):
                        metric_node = relation if relation and relation != "related_to" else "value"
                        if _is_noise_node(metric_node):
                            metric_node = "value"
                        relation_nodes.add(metric_node)
                        _add_weighted_edge(subject, metric_node)
                        edge_value_labels.setdefault((subject, metric_node), set()).add(obj)
                    else:
                        _add_weighted_edge(subject, obj)
                        if relation and relation != "related_to":
                            edge_relation_labels.setdefault((subject, obj), set()).add(relation)

                if engine == "hybrid" and g.number_of_edges() < 4:
                    for rel in relationships:
                        parts = _parse_parts(rel)
                        if len(parts) < 2:
                            continue
                        for i in range(len(parts) - 1):
                            src, dst = parts[i], parts[i + 1]
                            if _is_noise_node(src) or _is_noise_node(dst):
                                continue
                            _add_weighted_edge(src, dst)

            if g.number_of_nodes() == 0:
                return {
                    "image_url": None,
                    "image_base64": None,
                    "node_count": 0,
                    "edge_count": 0,
                    "engine_used": engine,
                    "error_message": "No valid relationship paths found.",
                }

            max_nodes = 20
            if g.number_of_nodes() > max_nodes:
                weighted_degrees = defaultdict(float)
                for u, v, data in g.edges(data=True):
                    w = float(data.get("weight", 1))
                    weighted_degrees[u] += w
                    weighted_degrees[v] += w
                top_nodes = [n for n, _ in sorted(weighted_degrees.items(), key=lambda x: x[1], reverse=True)[:max_nodes]]
                g = g.subgraph(top_nodes).copy()
                edge_value_labels = {
                    k: v for k, v in edge_value_labels.items()
                    if k[0] in g.nodes and k[1] in g.nodes
                }
                edge_relation_labels = {
                    k: v for k, v in edge_relation_labels.items()
                    if k[0] in g.nodes and k[1] in g.nodes
                }

            image_id = str(uuid.uuid4())
            image_path = VIZ_OUTPUT_DIR / f"{image_id}_knowledge_graph.png"

            if g.number_of_nodes() <= 14:
                pos = nx.kamada_kawai_layout(g)
            else:
                pos = nx.spring_layout(
                    g,
                    seed=42,
                    k=3.4 / max((g.number_of_nodes() ** 0.5), 1),
                    iterations=700,
                )

            fig_w = min(18, max(12, 0.75 * g.number_of_nodes()))
            fig_h = min(12, max(8, 0.52 * g.number_of_nodes()))
            fig = plt.figure(figsize=(fig_w, fig_h), dpi=150)
            ax = plt.gca()
            ax.set_facecolor("#0b1220")
            fig.patch.set_facecolor("#0b1220")

            degrees = dict(g.degree())
            wrapped_labels = {n: textwrap.fill(str(n).replace("_", " "), width=12) for n in g.nodes}

            def _node_size(n):
                label = wrapped_labels.get(n, str(n))
                lines = max(1, len([ln for ln in label.split("\n") if ln.strip()]))
                max_len = max((len(ln) for ln in label.split("\n")), default=len(str(n)))
                return 1250 + min(degrees.get(n, 1), 7) * 170 + lines * 340 + max_len * 35

            node_sizes = [_node_size(n) for n in g.nodes]
            node_colors = ["#fde68a" if n in relation_nodes else "#f8fafc" for n in g.nodes]
            edge_widths = [1.4 + min(float(data.get("weight", 1)) * 0.5, 2.0) for _, _, data in g.edges(data=True)]

            nx.draw_networkx_nodes(
                g, pos,
                node_size=node_sizes,
                node_color=node_colors,
                edgecolors="#fb8c36",
                linewidths=2.0,
            )
            nx.draw_networkx_edges(
                g, pos,
                edge_color="#fb8c36",
                width=edge_widths,
                alpha=0.85,
                arrows=True,
                arrowsize=16,
                connectionstyle="arc3,rad=0.07",
            )

            nx.draw_networkx_labels(
                g, pos,
                labels=wrapped_labels,
                font_size=8.2,
                font_weight="bold",
                font_color="#1e293b",
            )

            if edge_value_labels or edge_relation_labels:
                compact = {}
                for edge_key, rels in edge_relation_labels.items():
                    if edge_key in g.edges:
                        compact[edge_key] = sorted(list(rels))[0]
                for edge_key, vals in edge_value_labels.items():
                    if edge_key in g.edges:
                        values = sorted(list(vals))
                        val_text = ", ".join(values[:2]) + ("..." if len(values) > 2 else "")
                        if edge_key in compact:
                            compact[edge_key] = f"{compact[edge_key]} | {val_text}"
                        else:
                            compact[edge_key] = val_text
                if compact and g.number_of_edges() <= 20:
                    nx.draw_networkx_edge_labels(
                        g, pos,
                        edge_labels=compact,
                        font_size=6.6,
                        font_color="#cbd5e1",
                        rotate=False,
                        label_pos=0.52,
                        bbox={"boxstyle": "round,pad=0.2", "fc": "#0f172a", "ec": "none", "alpha": 0.88},
                    )

            plt.axis("off")
            plt.tight_layout()
            plt.savefig(image_path, bbox_inches="tight", pad_inches=0.25, transparent=False)
            plt.close()

            import base64
            image_b64 = None
            image_bytes = None
            try:
                with open(image_path, "rb") as f:
                    image_bytes = f.read()
                    image_b64 = "data:image/png;base64," + base64.b64encode(image_bytes).decode()
            except Exception:
                pass

            if settings.storage_provider == "azure" and image_bytes:
                blob = get_blob_storage()
                if blob.is_available():
                    paths = BlobPaths()
                    blob.upload_bytes(paths.viz_blob_name(f"{image_id}_knowledge_graph.png"), image_bytes, content_type="image/png")

            return {
                "image_url": f"/team3_ocr/api/v1/viz/images/{image_id}_knowledge_graph.png",
                "image_base64": image_b64,
                "node_count": g.number_of_nodes(),
                "edge_count": g.number_of_edges(),
                "engine_used": engine,
                "error_message": None,
            }
        except Exception as exc:
            return {
                "image_url": None,
                "image_base64": None,
                "node_count": 0,
                "edge_count": 0,
                "engine_used": engine,
                "error_message": f"Knowledge graph generation failed: {exc}",
            }

    result = await asyncio.to_thread(_generate)
    return KnowledgeGraphResponse(**result)

@router.get("/images/{image_name}")
async def get_visualization_image(image_name: str):
    """Serve a generated visualization image."""
    if settings.storage_provider == "azure":
        blob = get_blob_storage()
        if blob.is_available():
            paths = BlobPaths()
            payload = blob.download_bytes(paths.viz_blob_name(image_name))
            if payload is not None:
                return StreamingResponse(iter([payload]), media_type="image/png")

    image_path = VIZ_OUTPUT_DIR / image_name
    if not image_path.exists():
        raise HTTPException(404, "Image not found")
    return FileResponse(str(image_path), media_type="image/png")

