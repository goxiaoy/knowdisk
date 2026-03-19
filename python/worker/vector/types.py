from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Iterable, Mapping, Sequence
from typing import TypeAlias


@dataclass(frozen=True, slots=True)
class VectorRowEmbedding:
    values: tuple[float, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.values, tuple):
            object.__setattr__(self, "values", tuple(float(value) for value in self.values))

    @classmethod
    def from_iterable(cls, values: Iterable[float]) -> VectorRowEmbedding:
        return cls(values=tuple(float(value) for value in values))

    def to_legacy_list(self) -> list[float]:
        return list(self.values)


@dataclass(frozen=True, slots=True)
class VectorChunkRow:
    chunk_id: str
    node_id: str
    text: str
    embedding: VectorRowEmbedding
    mount_id: str = ""
    source_ref: str = ""
    name: str = ""
    title: str = ""

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> VectorChunkRow:
        embedding_value = value.get("embedding")
        if isinstance(embedding_value, VectorRowEmbedding):
            embedding = embedding_value
        elif isinstance(embedding_value, Sequence) and not isinstance(embedding_value, (str, bytes)):
            embedding = VectorRowEmbedding.from_iterable(float(item) for item in embedding_value)
        else:
            raise ValueError("vector chunk row embedding must be a sequence")

        return cls(
            chunk_id=str(value["chunkId"]),
            node_id=str(value["nodeId"]),
            text=str(value["text"]),
            embedding=embedding,
            mount_id=str(value.get("mountId") or ""),
            source_ref=str(value.get("sourceRef") or ""),
            name=str(value.get("name") or ""),
            title=str(value.get("title") or ""),
        )

    def to_legacy_dict(self) -> dict[str, object]:
        return {
            "chunkId": self.chunk_id,
            "nodeId": self.node_id,
            "mountId": self.mount_id,
            "sourceRef": self.source_ref,
            "name": self.name,
            "title": self.title,
            "text": self.text,
            "embedding": self.embedding.to_legacy_list(),
        }


VectorChunkRowInput: TypeAlias = VectorChunkRow | Mapping[str, object]
