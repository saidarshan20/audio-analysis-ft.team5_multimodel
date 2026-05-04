"""
Local search provider using FAISS for semantic similarity search.
Will be replaced by Azure AI Search when available.
"""

import asyncio
import json
import os
from pathlib import Path
from typing import Dict, Any, List
from modules.team3_ocr.providers.base import SearchProviderBase
from modules.team3_ocr.config import settings
from modules.team3_ocr.storage import BlobPaths, BlobStorageClient
import logging

logger = logging.getLogger(__name__)

INDEX_DIR = "./data/search_index"


class LocalSearchProvider(SearchProviderBase):
    """Semantic search using sentence-transformers + FAISS."""

    def __init__(self):
        self._blob = BlobStorageClient()
        self._blob_paths = BlobPaths()
        self._model = None
        self._index = None
        self._documents = {}  # doc_id -> metadata
        self._doc_store_path = Path(INDEX_DIR) / "doc_store.json"
        Path(INDEX_DIR).mkdir(parents=True, exist_ok=True)
        self._try_restore_from_blob()
        self._load_doc_store()

    def _blob_enabled(self) -> bool:
        return settings.storage_provider == "azure" and self._blob.is_available()

    def _try_restore_from_blob(self) -> None:
        """
        Best-effort restore of the local FAISS/embedding artifacts from blob storage.
        This keeps existing behavior (local files) but makes restarts pick up previous state.
        """
        if not self._blob_enabled():
            return

        prefix = self._blob_paths.search_index_prefix
        try:
            for blob_name in self._blob.list(prefix):
                rel = blob_name[len(prefix):]
                if not rel or rel.endswith("/"):
                    continue

                # Support both layouts:
                # - Flat:   ocr-workspace/search-index/<doc_id>_embeddings.npy
                # - Nested: ocr-workspace/search-index/<doc_id>/embeddings.npy
                if rel in {"doc_store.json", "faiss.index"}:
                    local_path = Path(INDEX_DIR) / rel
                elif rel.endswith(".npy"):
                    if "/" in rel:
                        doc_id = rel.split("/", 1)[0]
                        local_path = Path(INDEX_DIR) / f"{doc_id}_embeddings.npy"
                    else:
                        local_path = Path(INDEX_DIR) / rel
                else:
                    # Ignore unknown artifacts
                    continue

                if local_path.exists():
                    continue

                payload = self._blob.download_bytes(blob_name)
                if payload is None:
                    continue

                local_path.parent.mkdir(parents=True, exist_ok=True)
                with open(local_path, "wb") as f:
                    f.write(payload)
        except Exception as exc:
            logger.warning(f"Failed to restore search index from blob: {exc}")

    def _sync_index_files_to_blob(self) -> None:
        """
        Sync only the shared index files to blob storage.

        Important: we intentionally do NOT re-upload every `*_embeddings.npy` file on each update,
        otherwise all per-document blobs get overwritten and lose their individual Last modified timestamps.
        """
        if not self._blob_enabled():
            return

        prefix = self._blob_paths.search_index_prefix
        base = Path(INDEX_DIR)
        try:
            doc_store = base / "doc_store.json"
            faiss_index = base / "faiss.index"

            if doc_store.exists():
                with open(doc_store, "rb") as f:
                    self._blob.upload_bytes(f"{prefix}{doc_store.name}", f.read(), content_type="application/json")

            if faiss_index.exists():
                with open(faiss_index, "rb") as f:
                    self._blob.upload_bytes(f"{prefix}{faiss_index.name}", f.read(), content_type="application/octet-stream")
        except Exception as exc:
            logger.warning(f"Failed to sync search index files to blob: {exc}")

    def _upload_embeddings_file_to_blob(self, embeddings_path: str) -> None:
        if not self._blob_enabled():
            return
        try:
            p = Path(embeddings_path)
            if not p.exists():
                return
            prefix = self._blob_paths.search_index_prefix
            # Store under a doc-id folder for easier identification in Blob UI.
            doc_id = p.name.split("_", 1)[0]
            remote_name = f"{prefix}{doc_id}/embeddings.npy"
            with open(p, "rb") as f:
                self._blob.upload_bytes(remote_name, f.read(), content_type="application/octet-stream")
        except Exception as exc:
            logger.warning(f"Failed to upload embeddings to blob: {exc}")

    def _delete_embeddings_blob(self, embeddings_path: str) -> None:
        if not self._blob_enabled():
            return
        try:
            p = Path(embeddings_path)
            prefix = self._blob_paths.search_index_prefix
            doc_id = p.name.split("_", 1)[0]
            # New nested layout
            self._blob.delete(f"{prefix}{doc_id}/embeddings.npy")
            # Backward-compatible flat layout cleanup
            self._blob.delete(f"{prefix}{p.name}")
        except Exception:
            return

    def _get_model(self):
        """Lazy-load the sentence transformer model."""
        if self._model is False:
            return None
        if self._model is None:
            try:
                from sentence_transformers import SentenceTransformer
                self._model = SentenceTransformer(
                    "all-MiniLM-L6-v2",
                    trust_remote_code=True,
                )
                logger.info("Sentence-transformers model loaded successfully")
            except ImportError:
                logger.error("sentence-transformers not installed")
                self._model = False
            except Exception as e:
                logger.error(f"Failed to load sentence-transformers model: {e}")
                # Cache failure to avoid repeated expensive retries on every request.
                self._model = False
        return None if self._model is False else self._model

    def _load_doc_store(self):
        """Load document metadata from disk."""
        if self._doc_store_path.exists():
            with open(self._doc_store_path, "r") as f:
                self._documents = json.load(f)

    def _save_doc_store(self):
        """Persist document metadata to disk."""
        with open(self._doc_store_path, "w") as f:
            json.dump(self._documents, f, indent=2)
        self._sync_index_files_to_blob()

    async def index_document(self, doc_id: Any, text: str, metadata: Dict[str, Any]) -> bool:
        """Index a document's text for semantic search."""
        doc_id = str(doc_id)
        def _index():
            try:
                # Split text into smaller chunks for precise matching
                chunks = self._chunk_text(text, chunk_size=300, overlap=100)
                if not chunks:
                    return False

                # Store document metadata
                self._documents[doc_id] = {
                    "metadata": metadata,
                    "chunks": chunks,
                    "num_chunks": len(chunks),
                }

                model = self._get_model()
                # If semantic model is unavailable, keep lexical chunks indexed.
                if not model:
                    self._documents[doc_id].pop("embeddings_path", None)
                    self._save_doc_store()
                    return True

                import faiss
                import numpy as np

                # Generate embeddings and L2-normalize for cosine similarity
                embeddings = model.encode(chunks, show_progress_bar=False, normalize_embeddings=True)
                embeddings = np.array(embeddings).astype("float32")

                # Save embeddings for this document
                emb_path = str(Path(INDEX_DIR) / f"{doc_id}_embeddings.npy")
                np.save(emb_path, embeddings)
                self._documents[doc_id]["embeddings_path"] = emb_path
                self._upload_embeddings_file_to_blob(emb_path)

                # Rebuild FAISS index with all docs that have embeddings
                all_embeddings = []
                for did, doc_info in self._documents.items():
                    p = doc_info.get("embeddings_path")
                    if not p:
                        continue
                    if did == doc_id:
                        all_embeddings.append(embeddings)
                    elif os.path.exists(p):
                        all_embeddings.append(np.load(p))

                index_path = Path(INDEX_DIR) / "faiss.index"
                if all_embeddings:
                    combined = np.vstack(all_embeddings)
                    dim = combined.shape[1]
                    self._index = faiss.IndexFlatIP(dim)
                    self._index.add(combined)
                    faiss.write_index(self._index, str(index_path))
                else:
                    self._index = None
                    if index_path.exists():
                        index_path.unlink()

                self._save_doc_store()
                return True
            except Exception as e:
                logger.error(f"Indexing failed: {e}")
                return False

        return await asyncio.to_thread(_index)

    async def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """Search indexed documents using semantic similarity."""
        def _search():
            model = self._get_model()
            if not self._documents:
                return []

            try:
                import faiss
                import numpy as np

                # If semantic model/index is unavailable, use lexical fallback.
                if not model:
                    return self._keyword_search_all(query, top_k)

                # Load index if not in memory
                if self._index is None:
                    index_path = Path(INDEX_DIR) / "faiss.index"
                    if index_path.exists():
                        self._index = faiss.read_index(str(index_path))
                    else:
                        return self._keyword_search_all(query, top_k)

                # Encode query (normalized for cosine similarity)
                query_embedding = model.encode([query], normalize_embeddings=True).astype("float32")

                # Search (scores are cosine similarity: 1.0 = perfect, 0.0 = unrelated)
                scores, indices = self._index.search(query_embedding, min(top_k * 2, self._index.ntotal))

                # Map results back to documents and chunks
                results = []
                doc_order = list(self._documents.keys())

                for idx, cosine_score in zip(indices[0], scores[0]):
                    if idx == -1:
                        continue

                    score = round(float(cosine_score), 3)

                    # Threshold: skip weak matches
                    if score < 0.15:
                        continue

                    # Find which document and chunk this index belongs to
                    current_offset = 0
                    for did in doc_order:
                        num_chunks = self._documents[did]["num_chunks"]
                        if current_offset + num_chunks > idx:
                            chunk_idx = idx - current_offset
                            chunk_text = self._documents[did]["chunks"][chunk_idx]
                            results.append({
                                "doc_id": did,
                                "text_snippet": chunk_text,
                                "highlight": self._build_highlight(chunk_text, query),
                                "score": score,
                                "metadata": self._documents[did].get("metadata", {}),
                            })
                            break
                        current_offset += num_chunks

                # Keyword fallback: if semantic search found nothing, try exact text match
                if not results:
                    results = self._keyword_search_all(query, top_k)

                return results[:top_k]
            except Exception as e:
                logger.error(f"Search failed: {e}")
                return self._keyword_search_all(query, top_k)

        return await asyncio.to_thread(_search)

    async def search_document(self, doc_id: Any, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """Search within a single document's chunks (used for RAG context retrieval)."""
        doc_id = str(doc_id)
        def _search_doc():
            model = self._get_model()
            if doc_id not in self._documents:
                return []

            doc_info = self._documents[doc_id]
            chunks = doc_info.get("chunks", [])
            emb_path = doc_info.get("embeddings_path")

            if not chunks:
                return []
            if not model or not emb_path or not os.path.exists(emb_path):
                return self._keyword_search_in_chunks(chunks, query, top_k)

            try:
                import faiss
                import numpy as np

                embeddings = np.load(emb_path).astype("float32")
                query_embedding = model.encode([query], normalize_embeddings=True).astype("float32")

                # Build a temporary FAISS index using Inner Product (cosine sim)
                dim = embeddings.shape[1]
                tmp_index = faiss.IndexFlatIP(dim)
                tmp_index.add(embeddings)

                k = min(top_k, tmp_index.ntotal)
                scores, indices = tmp_index.search(query_embedding, k)

                results = []
                for idx, cosine_score in zip(indices[0], scores[0]):
                    if idx == -1:
                        continue
                    score = round(float(cosine_score), 3)

                    # Threshold: skip weak matches
                    if score < 0.15:
                        continue

                    results.append({
                        "text_snippet": chunks[idx],
                        "score": score,
                    })

                # Keyword fallback for RAG: if no semantic matches, find exact text matches
                if not results:
                    results = self._keyword_search_in_chunks(chunks, query, top_k)

                return results[:top_k]
            except Exception as e:
                logger.error(f"Document search failed for {doc_id}: {e}")
                return self._keyword_search_in_chunks(chunks, query, top_k)

        return await asyncio.to_thread(_search_doc)

    async def remove_document(self, doc_id: Any) -> bool:
        """Remove a document from the index."""
        doc_id = str(doc_id)
        if doc_id in self._documents:
            # Remove embeddings file
            emb_path = self._documents[doc_id].get("embeddings_path")
            if emb_path and os.path.exists(emb_path):
                os.remove(emb_path)
                self._delete_embeddings_blob(emb_path)
            del self._documents[doc_id]
            self._save_doc_store()
            # Rebuild index
            self._index = None
            return True
        return False

    @staticmethod
    def _chunk_text(text: str, chunk_size: int = 300, overlap: int = 100) -> List[str]:
        """Split text into overlapping chunks for fine-grained search."""
        words = text.split()
        chunks = []
        for i in range(0, len(words), chunk_size - overlap):
            chunk = " ".join(words[i:i + chunk_size])
            if chunk.strip():
                chunks.append(chunk)
        return chunks

    @staticmethod
    def _build_highlight(text: str, query: str, window: int = 80) -> str:
        """Build a highlight snippet around the first query-word occurrence."""
        text_lower = text.lower()
        query_words = query.lower().split()
        best_pos = -1
        for word in query_words:
            pos = text_lower.find(word)
            if pos != -1:
                best_pos = pos
                break
        if best_pos == -1:
            return text[:window * 2] + ("..." if len(text) > window * 2 else "")
        start = max(0, best_pos - window)
        end = min(len(text), best_pos + window)
        snippet = ("..." if start > 0 else "") + text[start:end] + ("..." if end < len(text) else "")
        return snippet

    def _keyword_search_all(self, query: str, top_k: int) -> List[Dict[str, Any]]:
        query_lower = query.lower()
        results: List[Dict[str, Any]] = []
        for did, doc_info in self._documents.items():
            for chunk in doc_info.get("chunks", []):
                if query_lower in chunk.lower():
                    results.append({
                        "doc_id": did,
                        "text_snippet": chunk,
                        "highlight": self._build_highlight(chunk, query),
                        "score": 0.5,
                        "metadata": doc_info.get("metadata", {}),
                    })
                    if len(results) >= top_k:
                        return results
        return results

    def _keyword_search_in_chunks(self, chunks: List[str], query: str, top_k: int) -> List[Dict[str, Any]]:
        query_lower = query.lower()
        results: List[Dict[str, Any]] = []
        for chunk in chunks:
            if query_lower in chunk.lower():
                results.append({
                    "text_snippet": chunk,
                    "score": 0.5,
                })
                if len(results) >= top_k:
                    break
        # If exact phrase not found, provide first chunks as context instead of empty.
        if not results and chunks:
            for chunk in chunks[:top_k]:
                results.append({"text_snippet": chunk, "score": 0.25})
        return results
