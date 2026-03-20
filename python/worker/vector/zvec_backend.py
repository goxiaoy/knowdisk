from __future__ import annotations

import hashlib
from pathlib import Path
from collections.abc import Sequence

import zvec

from worker.vector.types import VectorChunkRow, VectorRowEmbedding


class ZvecVectorBackend:
    def __init__(self, collection_path: str | Path) -> None:
        self._collection_path = Path(collection_path)
        self._collection: object | None = None

    def upsert(self, rows: list[VectorChunkRow]) -> None:
        if not rows:
            return
        collection = self._ensure_collection(dimension=len(rows[0].embedding.values))
        docs = [
            zvec.Doc(
                id=self._doc_id_for_chunk(row.chunk_id),
                fields={
                    "chunk_id": row.chunk_id,
                    "node_id": row.node_id,
                    "mount_id": row.mount_id,
                    "source_ref": row.source_ref,
                    "name": row.name,
                    "title": row.title,
                    "text": row.text,
                },
                vectors={"embedding": row.embedding.to_legacy_list()},
            )
            for row in rows
        ]
        collection.upsert(docs)

    def delete_by_node_id(self, node_id: str) -> None:
        collection = self._get_collection()
        if collection is None:
            return
        escaped_node_id = node_id.replace("'", "''")
        collection.delete_by_filter(f"node_id = '{escaped_node_id}'")

    def count(self) -> int:
        collection = self._get_collection()
        if collection is None:
            return 0
        stats = collection.stats
        return int(getattr(stats, "doc_count", 0))

    def search(self, query_embedding: Sequence[float], limit: int) -> list[VectorChunkRow]:
        collection = self._get_collection()
        if collection is None:
            return []
        docs = collection.query(
            zvec.VectorQuery("embedding", vector=list(float(value) for value in query_embedding)),
            topk=limit,
        )
        return [self._doc_to_row(doc) for doc in docs]

    def close(self) -> None:
        collection = self._collection
        if collection is None:
            return
        close = getattr(collection, "close", None)
        if callable(close):
            close()
        self._collection = None

    def _ensure_collection(self, *, dimension: int):
        existing = self._get_collection()
        if existing is not None:
            return existing
        self._collection_path.parent.mkdir(parents=True, exist_ok=True)
        if self._collection_path.exists():
            self._collection = zvec.open(str(self._collection_path))
            return self._collection
        schema = zvec.CollectionSchema(
            name="chunks",
            fields=[
                zvec.FieldSchema("chunk_id", zvec.DataType.STRING),
                zvec.FieldSchema("node_id", zvec.DataType.STRING),
                zvec.FieldSchema("mount_id", zvec.DataType.STRING),
                zvec.FieldSchema("source_ref", zvec.DataType.STRING),
                zvec.FieldSchema("name", zvec.DataType.STRING),
                zvec.FieldSchema("title", zvec.DataType.STRING),
                zvec.FieldSchema("text", zvec.DataType.STRING),
            ],
            vectors=zvec.VectorSchema("embedding", zvec.DataType.VECTOR_FP32, dimension),
        )
        self._collection = zvec.create_and_open(str(self._collection_path), schema=schema)
        return self._collection

    def _get_collection(self):
        if self._collection is not None:
            return self._collection
        if not self._collection_path.exists():
            return None
        self._collection = zvec.open(str(self._collection_path))
        return self._collection

    def _doc_to_row(self, doc: object) -> VectorChunkRow:
        fields = getattr(doc, "fields", {})
        if not isinstance(fields, dict):
            fields = {}
        return VectorChunkRow(
            chunk_id=str(fields.get("chunk_id") or getattr(doc, "id")),
            node_id=str(fields.get("node_id") or ""),
            mount_id=str(fields.get("mount_id") or ""),
            source_ref=str(fields.get("source_ref") or ""),
            name=str(fields.get("name") or ""),
            title=str(fields.get("title") or ""),
            text=str(fields.get("text") or ""),
            embedding=VectorRowEmbedding.from_iterable(()),
            score=self._coerce_score(getattr(doc, "score", None)),
        )

    def _doc_id_for_chunk(self, chunk_id: str) -> str:
        digest = hashlib.sha1(chunk_id.encode("utf-8")).hexdigest()
        return f"chunk_{digest}"

    def _coerce_score(self, value: object) -> float | None:
        if isinstance(value, (int, float)):
            return float(value)
        return None
