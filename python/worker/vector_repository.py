from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol


class VectorBackend(Protocol):
    def upsert(self, rows: list[dict[str, Any]]) -> None: ...

    def delete_by_node_id(self, node_id: str) -> None: ...

    def count(self) -> int: ...


class InMemoryVectorBackend:
    def __init__(self) -> None:
        self._rows: dict[str, dict[str, Any]] = {}

    def upsert(self, rows: list[dict[str, Any]]) -> None:
        for row in rows:
            self._rows[str(row["chunkId"])] = row

    def delete_by_node_id(self, node_id: str) -> None:
        for chunk_id in [
            chunk_id for chunk_id, row in self._rows.items() if str(row["nodeId"]) == node_id
        ]:
            del self._rows[chunk_id]

    def count(self) -> int:
        return len(self._rows)


class VectorRepository:
    def __init__(self, collection_path: str, backend: VectorBackend | None = None) -> None:
        self.collection_path = str(Path(collection_path))
        self.backend = backend or InMemoryVectorBackend()

    def upsert_chunks(self, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        self.backend.upsert(rows)

    def delete_by_node_id(self, node_id: str) -> None:
        self.backend.delete_by_node_id(node_id)

    def count_chunks(self) -> int:
        return self.backend.count()
