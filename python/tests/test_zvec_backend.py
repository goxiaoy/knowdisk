from pathlib import Path

from worker.vector.types import VectorChunkRow, VectorRowEmbedding
from worker.vector.zvec_backend import ZvecVectorBackend


def test_zvec_backend_upserts_counts_and_searches(tmp_path: Path):
    backend = ZvecVectorBackend(collection_path=tmp_path / "index.zvec")
    backend.upsert(
        [
            VectorChunkRow(
                chunk_id="chunk-1",
                node_id="node-1",
                mount_id="mount-1",
                source_ref="alpha.md",
                name="alpha.md",
                title="Alpha",
                text="alpha topic",
                embedding=VectorRowEmbedding(values=[1.0, 0.0]),
            ),
            VectorChunkRow(
                chunk_id="chunk-2",
                node_id="node-2",
                mount_id="mount-1",
                source_ref="beta.md",
                name="beta.md",
                title="Beta",
                text="beta topic",
                embedding=VectorRowEmbedding(values=[0.0, 1.0]),
            ),
        ]
    )

    assert backend.count() == 2
    results = backend.search((0.0, 1.0), limit=1)

    assert len(results) == 1
    assert results[0].chunk_id == "chunk-2"
    assert results[0].node_id == "node-2"
    assert results[0].text == "beta topic"


def test_zvec_backend_deletes_rows_by_node_id(tmp_path: Path):
    backend = ZvecVectorBackend(collection_path=tmp_path / "index.zvec")
    backend.upsert(
        [
            VectorChunkRow(
                chunk_id="chunk-1",
                node_id="node-1",
                text="alpha",
                embedding=VectorRowEmbedding(values=[1.0, 0.0]),
            ),
            VectorChunkRow(
                chunk_id="chunk-2",
                node_id="node-2",
                text="beta",
                embedding=VectorRowEmbedding(values=[0.0, 1.0]),
            ),
        ]
    )

    backend.delete_by_node_id("node-1")

    assert backend.count() == 1
    results = backend.search((1.0, 0.0), limit=2)
    assert [row.chunk_id for row in results] == ["chunk-2"]
