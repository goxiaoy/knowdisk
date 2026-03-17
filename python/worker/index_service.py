from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from worker.status import VectorStatusStore
from worker.vector_repository import VectorRepository


Parser = Callable[[dict[str, Any], dict[str, Any]], list[dict[str, Any]]]


class IndexService:
    def __init__(
        self,
        parse_node: Parser,
        model_service: Any,
        vector_repository: VectorRepository,
        vector_status_store: VectorStatusStore,
    ) -> None:
        self._parse_node = parse_node
        self._model_service = model_service
        self._vector_repository = vector_repository
        self._vector_status_store = vector_status_store
        self._search_rows: list[dict[str, Any]] = []

    def index_node(self, node: dict[str, Any], mount: dict[str, Any]) -> dict[str, int]:
        chunks = self._parse_node(node, mount)
        embedding_runtime = self._model_service.get_local_embedding_runtime()
        rows: list[dict[str, Any]] = []

        for chunk in chunks:
            if chunk["status"] != "ok":
                continue
            rows.append(
                {
                    "chunkId": f'{node["nodeId"]}:{chunk["chunkIndex"]}',
                    "nodeId": node["nodeId"],
                    "mountId": node.get("mountId", ""),
                    "sourceRef": node.get("sourceRef", ""),
                    "name": node["name"],
                    "title": chunk.get("title"),
                    "text": chunk["text"],
                    "embedding": embedding_runtime(chunk["text"]),
                }
            )

        self._vector_repository.upsert_chunks(rows)
        self._search_rows = [row for row in self._search_rows if row["nodeId"] != node["nodeId"]]
        self._search_rows.extend(rows)
        self._vector_status_store.update(
            chunkCount=self._vector_repository.count_chunks(),
            lastUpdatedAt=now_iso(),
            error="",
        )
        return {"indexed": len(rows)}

    def delete_node(self, node_id: str) -> None:
        self._vector_repository.delete_by_node_id(node_id)
        self._search_rows = [row for row in self._search_rows if row["nodeId"] != node_id]
        self._vector_status_store.update(
            chunkCount=self._vector_repository.count_chunks(),
            lastUpdatedAt=now_iso(),
            error="",
        )

    def search(self, query: str) -> list[dict[str, Any]]:
        normalized = query.strip().lower()
        if not normalized:
            return []
        return [row for row in self._search_rows if normalized in row["text"].lower()]

    def vector_status_snapshot(self) -> dict[str, Any]:
        return self._vector_status_store.snapshot()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
