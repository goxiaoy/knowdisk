from pathlib import Path

from worker.index_queue import IndexQueue
from worker.index_service import IndexService
from worker.model_service import ModelService
from worker.parser_service import parse_node as parse_node_from_mount
from worker.status import IndexStatusStore, ModelStatusStore, VectorStatusStore
from worker.vector_repository import VectorRepository


def test_simple_file_indexes_through_parser_queue_and_vector_store(tmp_path: Path):
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    (source_dir / "note.md").write_text("# Hello\n\nIntegration body", encoding="utf-8")

    model_store = ModelStatusStore(event_sink=lambda event: None)
    index_store = IndexStatusStore(event_sink=lambda event: None)
    vector_store = VectorStatusStore(event_sink=lambda event: None)
    model_service = create_model_service(model_store)
    model_service.ensure_required_models()
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"))
    index_service = IndexService(
        parse_node=parse_node_from_mount,
        model_service=model_service,
        vector_repository=repository,
        vector_status_store=vector_store,
    )
    queue = IndexQueue(status_store=index_store, rebuild_concurrency=2)

    queue.enqueue_incremental(
        "note.md",
        lambda: index_service.index_node(
            node={
                "nodeId": "node-1",
                "mountId": "mount-1",
                "name": "note.md",
                "sourceRef": "note.md",
                "providerVersion": "v1",
            },
            mount={
                "mountId": "mount-1",
                "providerType": "local",
                "directory": str(source_dir),
                "contentDir": "",
            },
        ),
    )

    assert queue.snapshot()["phase"] == "idle"
    assert queue.snapshot()["processedFiles"] == 1
    assert repository.count_chunks() == 1
    assert index_service.vector_status_snapshot()["chunkCount"] == 1
    assert index_service.search("integration")[0]["sourceRef"] == "note.md"


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
                        "nodeId": node["nodeId"],
                        "name": node["name"],
                        "path": source_path,
                    },
                }
            ],
        ),
        model_service=model_service,
        vector_repository=repository,
        vector_status_store=vector_store,
    )

    result = index_service.index_node(
        node={
            "nodeId": "node-2",
            "mountId": "mount-1",
            "name": "paper.pdf",
            "sourceRef": "paper.pdf",
            "providerVersion": "v1",
        },
        mount={
            "mountId": "mount-1",
            "providerType": "local",
            "directory": str(source_dir),
            "contentDir": "",
        },
    )

    assert result == {"indexed": 1}
    assert repository.count_chunks() == 1
    assert index_service.search("docling")[0]["name"] == "paper.pdf"


def test_rebuild_queue_updates_processed_counts_and_vector_rows(tmp_path: Path):
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    (source_dir / "a.md").write_text("alpha", encoding="utf-8")
    (source_dir / "b.txt").write_text("beta", encoding="utf-8")

    model_store = ModelStatusStore(event_sink=lambda event: None)
    index_store = IndexStatusStore(event_sink=lambda event: None)
    vector_store = VectorStatusStore(event_sink=lambda event: None)
    model_service = create_model_service(model_store)
    model_service.ensure_required_models()
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"))
    index_service = IndexService(
        parse_node=parse_node_from_mount,
        model_service=model_service,
        vector_repository=repository,
        vector_status_store=vector_store,
    )
    queue = IndexQueue(status_store=index_store, rebuild_concurrency=2)

    queue.rebuild_all(
        [
            (
                "a.md",
                lambda: index_service.index_node(
                    node={
                        "nodeId": "node-a",
                        "mountId": "mount-1",
                        "name": "a.md",
                        "sourceRef": "a.md",
                        "providerVersion": "v1",
                    },
                    mount={
                        "mountId": "mount-1",
                        "providerType": "local",
                        "directory": str(source_dir),
                        "contentDir": "",
                    },
                ),
            ),
            (
                "b.txt",
                lambda: index_service.index_node(
                    node={
                        "nodeId": "node-b",
                        "mountId": "mount-1",
                        "name": "b.txt",
                        "sourceRef": "b.txt",
                        "providerVersion": "v1",
                    },
                    mount={
                        "mountId": "mount-1",
                        "providerType": "local",
                        "directory": str(source_dir),
                        "contentDir": "",
                    },
                ),
            ),
        ]
    )

    assert queue.snapshot()["processedFiles"] == 2
    assert queue.snapshot()["totalFiles"] == 2
    assert queue.snapshot()["phase"] == "idle"
    assert repository.count_chunks() == 2
    assert index_service.vector_status_snapshot()["chunkCount"] == 2


def create_model_service(status_store: ModelStatusStore) -> ModelService:
    return ModelService(
        status_store=status_store,
        verify_embedding=lambda: None,
        verify_reranker=lambda: None,
        load_embedding_runtime=lambda: lambda text: [float(len(text))],
        load_reranker_runtime=lambda: {"provider": "stub-reranker"},
    )
