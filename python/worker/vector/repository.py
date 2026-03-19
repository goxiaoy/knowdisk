from __future__ import annotations

from pathlib import Path
from collections.abc import Sequence
from typing import Protocol

from worker.vector.types import VectorChunkRow, VectorChunkRowInput

class VectorBackend(Protocol):
    def upsert(self, rows: list[VectorChunkRow]) -> None: ...

    def delete_by_node_id(self, node_id: str) -> None: ...

    def count(self) -> int: ...


class InMemoryVectorBackend:
    def __init__(self) -> None:
        self._rows: dict[str, VectorChunkRow] = {}

    def upsert(self, rows: list[VectorChunkRow]) -> None:
        for row in rows:
            self._rows[row.chunk_id] = row

    def delete_by_node_id(self, node_id: str) -> None:
        for chunk_id in [
            chunk_id for chunk_id, row in self._rows.items() if row.node_id == node_id
        ]:
            del self._rows[chunk_id]

    def count(self) -> int:
        return len(self._rows)


class VectorRepository:
    def __init__(self, collection_path: str, backend: VectorBackend | None = None) -> None:
        self.collection_path = str(Path(collection_path))
        self.backend = backend or InMemoryVectorBackend()

    def upsert_chunks(self, rows: Sequence[VectorChunkRowInput]) -> None:
        if not rows:
            return
        normalized_rows = [coerce_vector_chunk_row(row) for row in rows]
        self.backend.upsert(normalized_rows)

    def delete_by_node_id(self, node_id: str) -> None:
        self.backend.delete_by_node_id(node_id)

    def count_chunks(self) -> int:
        return self.backend.count()


def coerce_vector_chunk_row(value: VectorChunkRowInput) -> VectorChunkRow:
    if isinstance(value, VectorChunkRow):
        return value
    return VectorChunkRow.from_mapping(value)
