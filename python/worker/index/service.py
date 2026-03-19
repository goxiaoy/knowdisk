from __future__ import annotations

from datetime import datetime, timezone
from collections.abc import Callable, Mapping

from worker.runtime.status import VectorStatusStore
from worker.runtime.types import (
    IndexNodeRequest,
    IndexNodeResult,
    coerce_index_node_request,
)
from worker.vector.repository import VectorRepository
from worker.vector.types import VectorChunkRow, VectorRowEmbedding


Parser = Callable[[object, object], list[dict[str, object]]]


class IndexService:
    def __init__(
        self,
        parse_node: Parser,
        model_service: object,
        vector_repository: VectorRepository,
        vector_status_store: VectorStatusStore,
    ) -> None:
        self._parse_node = parse_node
        self._model_service = model_service
        self._vector_repository = vector_repository
        self._vector_status_store = vector_status_store
        self._search_rows: list[dict[str, object]] = []

    def index_node(
        self,
        request: IndexNodeRequest | Mapping[str, object],
    ) -> IndexNodeResult:
        parsed_request = coerce_index_node_request(request)
        chunks = self._parse_node(parsed_request.node, parsed_request.mount)
        embedding_runtime = self._model_service.get_local_embedding_runtime()
        rows: list[VectorChunkRow] = []

        for chunk in chunks:
            if chunk["status"] != "ok":
                continue
            row = VectorChunkRow(
                chunk_id=f'{parsed_request.node.node_id}:{chunk["chunkIndex"]}',
                node_id=parsed_request.node.node_id,
                mount_id=parsed_request.node.mount_id,
                source_ref=parsed_request.node.source_ref,
                name=parsed_request.node.name,
                title=str(chunk.get("title") or ""),
                text=str(chunk["text"]),
                embedding=VectorRowEmbedding.from_iterable(embedding_runtime(chunk["text"])),
            )
            rows.append(row)

        self._vector_repository.upsert_chunks(rows)
        self._search_rows = [
            row for row in self._search_rows if row["nodeId"] != parsed_request.node.node_id
        ]
        self._search_rows.extend(row.to_legacy_dict() for row in rows)
        self._vector_status_store.update(
            chunkCount=self._vector_repository.count_chunks(),
            lastUpdatedAt=now_iso(),
            error="",
        )
        return IndexNodeResult(indexed=len(rows))

    def delete_node(self, node_id: str) -> None:
        self._vector_repository.delete_by_node_id(node_id)
        self._search_rows = [row for row in self._search_rows if row["nodeId"] != node_id]
        self._vector_status_store.update(
            chunkCount=self._vector_repository.count_chunks(),
            lastUpdatedAt=now_iso(),
            error="",
        )

    def search(self, query: str) -> list[dict[str, object]]:
        normalized = query.strip().lower()
        if not normalized:
            return []
        embedding_runtime = self._model_service.get_local_embedding_runtime()
        query_embedding = embedding_runtime(query)
        return self._vector_repository.search(query_embedding, limit=10)

    def vector_status_snapshot(self) -> dict[str, object]:
        return self._vector_status_store.snapshot()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
