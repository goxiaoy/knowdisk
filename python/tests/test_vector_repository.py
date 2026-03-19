from pathlib import Path

from worker.vector.repository import VectorRepository
from worker.vector.types import VectorChunkRow, VectorRowEmbedding


class FakeBackend:
    def __init__(self) -> None:
        self.rows: dict[str, VectorChunkRow] = {}
        self.search_calls: list[tuple[tuple[float, ...], int]] = []

    def upsert(self, rows: list[VectorChunkRow]) -> None:
        for row in rows:
            self.rows[row.chunk_id] = row

    def delete_by_node_id(self, node_id: str) -> None:
        to_delete = [chunk_id for chunk_id, row in self.rows.items() if row.node_id == node_id]
        for chunk_id in to_delete:
            del self.rows[chunk_id]

    def count(self) -> int:
        return len(self.rows)

    def search(self, query_embedding: tuple[float, ...], limit: int) -> list[VectorChunkRow]:
        self.search_calls.append((query_embedding, limit))
        return list(self.rows.values())[:limit]


def test_repository_initializes_with_collection_path(tmp_path: Path):
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"), backend=FakeBackend())

    assert repository.collection_path == str(tmp_path / "index.zvec")


def test_repository_upserts_normalized_chunk_rows(tmp_path: Path):
    backend = FakeBackend()
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"), backend=backend)

    repository.upsert_chunks(
        [
            VectorChunkRow(
                chunk_id="chunk-1",
                node_id="node-1",
                text="hello",
                embedding=VectorRowEmbedding(values=[0.1, 0.2]),
            )
        ]
    )

    assert backend.rows["chunk-1"].text == "hello"
    assert backend.rows["chunk-1"].embedding.values == (0.1, 0.2)


def test_repository_deletes_rows_by_node_id(tmp_path: Path):
    backend = FakeBackend()
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"), backend=backend)
    repository.upsert_chunks(
        [
            VectorChunkRow(
                chunk_id="chunk-1",
                node_id="node-1",
                text="hello",
                embedding=VectorRowEmbedding(values=[0.1, 0.2]),
            ),
            VectorChunkRow(
                chunk_id="chunk-2",
                node_id="node-2",
                text="world",
                embedding=VectorRowEmbedding(values=[0.3, 0.4]),
            ),
        ]
    )

    repository.delete_by_node_id("node-1")

    assert set(backend.rows) == {"chunk-2"}


def test_repository_reports_chunk_count(tmp_path: Path):
    backend = FakeBackend()
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"), backend=backend)
    repository.upsert_chunks(
        [
            VectorChunkRow(
                chunk_id="chunk-1",
                node_id="node-1",
                text="hello",
                embedding=VectorRowEmbedding(values=[0.1, 0.2]),
            )
        ]
    )

    assert repository.count_chunks() == 1


def test_repository_searches_by_query_embedding(tmp_path: Path):
    backend = FakeBackend()
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"), backend=backend)
    repository.upsert_chunks(
        [
            VectorChunkRow(
                chunk_id="chunk-1",
                node_id="node-1",
                text="hello",
                embedding=VectorRowEmbedding(values=[0.1, 0.2]),
                source_ref="hello.md",
                name="hello.md",
                title="Hello",
            )
        ]
    )

    results = repository.search([0.1, 0.2], limit=3)

    assert backend.search_calls == [((0.1, 0.2), 3)]
    assert results == [
        {
            "chunkId": "chunk-1",
            "nodeId": "node-1",
            "mountId": "",
            "sourceRef": "hello.md",
            "name": "hello.md",
            "title": "Hello",
            "text": "hello",
            "embedding": [0.1, 0.2],
        }
    ]
