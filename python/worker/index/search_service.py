from __future__ import annotations

from worker.index.chunk_store import SQLiteChunkStore
from worker.runtime.types import SearchResponsePayload, SearchResultSnapshot
from worker.vector.repository import VectorRepository


class SearchService:
    def __init__(
        self,
        *,
        chunk_store: SQLiteChunkStore,
        vector_repository: VectorRepository,
    ) -> None:
        self._chunk_store = chunk_store
        self._vector_repository = vector_repository

    def search(
        self,
        *,
        query: str,
        query_embedding: tuple[float, ...],
        reranker_runtime: object | None,
        title_only: bool = False,
        limit: int = 10,
    ) -> SearchResponsePayload:
        fts_results = [
            _with_fts_metadata(row.to_legacy_dict(), rank)
            for rank, row in enumerate(
                self._chunk_store.search_fts(query, limit=limit, title_only=title_only)
            )
        ]
        vector_results = [
            _with_vector_metadata(row, rank)
            for rank, row in enumerate(
                self._vector_repository.search(query_embedding, limit=limit)
            )
        ]
        merged_candidates = _merge_candidates(fts_results, vector_results)
        reranked_results = _rerank_candidates(
            query=query,
            candidates=merged_candidates,
            reranker_runtime=reranker_runtime,
        )
        final_results = reranked_results[:limit]
        return {
            "query": query,
            "titleOnly": title_only,
            "debug": {
                "ftsResults": fts_results,
                "vectorResults": vector_results,
                "mergedCandidates": merged_candidates,
                "rerankedResults": reranked_results,
                "finalResults": final_results,
            },
        }


def _with_fts_metadata(row: dict[str, object], rank: int) -> SearchResultSnapshot:
    result = dict(row)
    result["ftsScore"] = 1.0 / float(rank + 1)
    result["matchedBy"] = ["fts"]
    return result


def _with_vector_metadata(row: dict[str, object], rank: int) -> SearchResultSnapshot:
    result = dict(row)
    result["vectorScore"] = float(result.get("score") or 0.0)
    result["matchedBy"] = ["vector"]
    return result


def _merge_candidates(
    fts_results: list[SearchResultSnapshot],
    vector_results: list[SearchResultSnapshot],
) -> list[SearchResultSnapshot]:
    merged: dict[str, SearchResultSnapshot] = {}
    ordered_chunk_ids: list[str] = []

    for row in vector_results:
        chunk_id = str(row["chunkId"])
        merged[chunk_id] = dict(row)
        ordered_chunk_ids.append(chunk_id)

    for row in fts_results:
        chunk_id = str(row["chunkId"])
        existing = merged.get(chunk_id)
        if existing is None:
            merged[chunk_id] = dict(row)
            ordered_chunk_ids.append(chunk_id)
            continue
        existing["ftsScore"] = float(row.get("ftsScore") or 0.0)
        matched_by = list(existing.get("matchedBy") or [])
        if "fts" not in matched_by:
            matched_by.append("fts")
        existing["matchedBy"] = matched_by

    return [merged[chunk_id] for chunk_id in ordered_chunk_ids]


def _rerank_candidates(
    *,
    query: str,
    candidates: list[SearchResultSnapshot],
    reranker_runtime: object | None,
) -> list[SearchResultSnapshot]:
    scored: list[tuple[float, int, SearchResultSnapshot]] = []
    for index, candidate in enumerate(candidates):
        rerank_score = _score_with_reranker(reranker_runtime, query, candidate)
        enriched = dict(candidate)
        enriched["rerankScore"] = rerank_score
        scored.append((rerank_score, index, enriched))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [candidate for _, _, candidate in scored]


def _score_with_reranker(
    reranker_runtime: object | None,
    query: str,
    candidate: SearchResultSnapshot,
) -> float:
    if callable(reranker_runtime):
        score = reranker_runtime(query, candidate)
        if isinstance(score, (int, float)):
            return float(score)
    vector_score = candidate.get("vectorScore")
    if isinstance(vector_score, (int, float)):
        return float(vector_score)
    fts_score = candidate.get("ftsScore")
    if isinstance(fts_score, (int, float)):
        return float(fts_score)
    return 0.0
