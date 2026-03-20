import io
import sqlite3
import time
from pathlib import Path

from worker.index.queue import IndexQueue
from worker.index.service import IndexService
from worker.model.service import ModelService
from worker.parser.types import ParserMount, ParserNode
from worker.parser.service import parse_node as parse_node_from_mount
from worker.runtime.bootstrap import create_worker_runtime
from worker.runtime.status import IndexStatusStore, ModelStatusStore, VectorStatusStore
from worker.runtime.types import IndexNodeRequest
from worker.vector.repository import VectorRepository


def test_simple_file_indexes_through_parser_queue_and_vector_store(
    tmp_path: Path,
    monkeypatch,
):
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    (source_dir / "note.md").write_text("# Hello\n\nIntegration body", encoding="utf-8")

    monkeypatch.setenv("KNOWDISK_PYTHON_FAKE_MODEL_RUNTIME", "1")
    runtime = create_worker_runtime(
        stdin=io.BytesIO(),
        stdout=io.BytesIO(),
        stderr=io.StringIO(),
    )
    try:
        start_response = runtime.server.handle_request(
            {
                "id": "req-start",
                "method": "start",
                "params": {
                    "basePath": str(tmp_path),
                    "embeddingModel": "Alibaba-NLP/gte-multilingual-base",
                    "rerankerModel": "Alibaba-NLP/gte-multilingual-reranker-base",
                    "preferredDevice": "cpu",
                },
            }
        )
        runtime.start_index_worker()
        assert start_response["result"]["ok"] is True

        response = runtime.server.handle_request(
            {
                "id": "req-index",
                "method": "index_node",
                "params": {
                    "node": {
                        "nodeId": "node-1",
                        "mountId": "mount-1",
                        "name": "note.md",
                        "sourceRef": "note.md",
                        "providerType": "local",
                    },
                    "mount": {
                        "providerType": "local",
                        "syncedContentPath": "",
                        "localFilePath": str(source_dir / "note.md"),
                    },
                },
            }
        )

        assert response == {"id": "req-index", "result": {"queued": True}}
        _wait_for(
            lambda: runtime.server.services.index_service.vector_status_snapshot()["chunkCount"]
            == 1
            and runtime.server.services.index_queue.snapshot()["phase"] == "idle"
        )

        assert runtime.server.services.index_queue.snapshot()["phase"] == "idle"
        assert runtime.server.services.index_service.vector_status_snapshot()["chunkCount"] == 1
        search_payload = runtime.server.services.index_service.search("integration")
        assert search_payload["debug"]["ftsResults"]
        assert search_payload["debug"]["vectorResults"]
        assert search_payload["debug"]["rerankedResults"]
        assert isinstance(search_payload["debug"]["finalResults"][0]["rerankScore"], float)
        assert search_payload["debug"]["finalResults"][0]["sourceRef"] == "note.md"
        with sqlite3.connect(tmp_path / "index.sqlite3") as connection:
            row = connection.execute(
                "SELECT chunk_id, title, text FROM index_chunks WHERE node_id = ?",
                ("node-1",),
            ).fetchone()
        assert row == ("node-1:0", "note", "# Hello\n\nIntegration body")
        assert (tmp_path / "parser" / "node-1" / "document.md").read_text(encoding="utf-8") == "# Hello\n\nIntegration body"
    finally:
        runtime.stop_index_worker()


def test_docling_stubbed_parse_indexes_pdf_through_full_service_stack(tmp_path: Path):
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    (source_dir / "paper.pdf").write_bytes(b"%PDF-1.7")

    model_store = ModelStatusStore(event_sink=lambda event: None)
    vector_store = VectorStatusStore(event_sink=lambda event: None)
    model_service = create_model_service(model_store)
    model_service.ensure_required_models()
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"))
    index_service = IndexService(
        parse_node=lambda node, mount: parse_node_from_mount(
            node,
            mount,
            parse_docling=lambda node, source_path: [
                {
                    "status": "ok",
                    "chunkIndex": 0,
                    "text": "Docling integration body",
                    "title": "Paper",
                    "source": {
                        "nodeId": node.node_id,
                        "name": node.name,
                        "path": source_path,
                    },
                }
            ],
        ),
        model_service=model_service,
        vector_repository=repository,
        vector_status_store=vector_store,
        parser_base_dir=tmp_path / "parser",
    )

    result = index_service.index_node(
        IndexNodeRequest(
            node=ParserNode(
                node_id="node-2",
                mount_id="mount-1",
                name="paper.pdf",
                source_ref="paper.pdf",
                provider_type="local",
            ),
            mount=ParserMount(
                synced_content_path="",
                local_file_path=str(source_dir / "paper.pdf"),
                provider_type="local",
            ),
        ),
    )

    assert result.indexed == 1
    assert repository.count_chunks() == 1
    assert index_service.search("docling")["debug"]["finalResults"][0]["name"] == "paper.pdf"
    assert (tmp_path / "parser" / "node-2" / "document.md").read_text(encoding="utf-8") == "Docling integration body"


def test_incremental_replay_updates_processed_counts_and_vector_rows(tmp_path: Path, monkeypatch):
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    (source_dir / "a.md").write_text("alpha", encoding="utf-8")
    (source_dir / "b.txt").write_text("beta", encoding="utf-8")

    monkeypatch.setenv("KNOWDISK_PYTHON_FAKE_MODEL_RUNTIME", "1")
    runtime = create_worker_runtime(
        stdin=io.BytesIO(),
        stdout=io.BytesIO(),
        stderr=io.StringIO(),
    )
    try:
        runtime.server.handle_request(
            {
                "id": "req-start",
                "method": "start",
                "params": {
                    "basePath": str(tmp_path),
                    "embeddingModel": "Alibaba-NLP/gte-multilingual-base",
                    "rerankerModel": "Alibaba-NLP/gte-multilingual-reranker-base",
                    "preferredDevice": "cpu",
                },
            }
        )
        runtime.start_index_worker()

        runtime.server.handle_request(
            {
                "id": "req-a",
                "method": "index_node",
                "params": {
                    "node": {
                        "nodeId": "node-a",
                        "mountId": "mount-1",
                        "name": "a.md",
                        "sourceRef": "a.md",
                        "providerType": "local",
                    },
                    "mount": {
                        "providerType": "local",
                        "syncedContentPath": "",
                        "localFilePath": str(source_dir / "a.md"),
                    },
                },
            }
        )
        runtime.server.handle_request(
            {
                "id": "req-b",
                "method": "index_node",
                "params": {
                    "node": {
                        "nodeId": "node-b",
                        "mountId": "mount-1",
                        "name": "b.txt",
                        "sourceRef": "b.txt",
                        "providerType": "local",
                    },
                    "mount": {
                        "providerType": "local",
                        "syncedContentPath": "",
                        "localFilePath": str(source_dir / "b.txt"),
                    },
                },
            }
        )

        _wait_for(
            lambda: runtime.server.services.index_service.vector_status_snapshot()["chunkCount"]
            == 2
        )

        assert runtime.server.services.index_queue.snapshot()["phase"] == "idle"
        assert runtime.server.services.index_queue.snapshot()["processedFiles"] == 1
        assert runtime.server.services.index_queue.snapshot()["totalFiles"] == 1
        assert runtime.server.services.index_service.vector_status_snapshot()["chunkCount"] == 2
        with sqlite3.connect(tmp_path / "index.sqlite3") as connection:
            count = connection.execute("SELECT COUNT(*) FROM index_chunks").fetchone()[0]
        assert count == 2
    finally:
        runtime.stop_index_worker()


def create_model_service(status_store: ModelStatusStore) -> ModelService:
    return ModelService(
        status_store=status_store,
        verify_embedding=lambda: None,
        verify_reranker=lambda: None,
        load_embedding_runtime=lambda: lambda text: [float(len(text))],
        load_reranker_runtime=lambda: {"provider": "stub-reranker"},
    )


def _wait_for(predicate, timeout_seconds: float = 5.0) -> None:
    started = time.monotonic()
    while not predicate():
        if time.monotonic() - started > timeout_seconds:
            raise AssertionError("timed out waiting for background index worker")
        time.sleep(0.05)
