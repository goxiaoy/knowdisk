import io
import sqlite3
import time
import json
from pathlib import Path

from worker.index.queue import IndexQueue
from worker.index.service import IndexService
from worker.model.service import ModelService
from worker.model.types import DEFAULT_OCR_MODEL_DISPLAY, ModelRuntimeConfig
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
                    "coreConfig": {
                        "embedding": {
                            "provider": "local",
                            "local": {"model": "Alibaba-NLP/gte-multilingual-base"},
                        },
                        "reranker": {
                            "enabled": True,
                            "provider": "local",
                            "local": {"model": "Alibaba-NLP/gte-multilingual-reranker-base"},
                        },
                            "ocr": {
                                "provider": "local",
                                "local": {"model": "PaddlePaddle/PP-OCRv4_mobile"},
                            },
                        "caption": {
                            "provider": "local",
                            "local": {"model": "vikhyatk/moondream2"},
                        },
                        "providers": {
                            "huggingface": {"endpoint": "https://huggingface.co"},
                        },
                    },
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
        with sqlite3.connect(tmp_path / "index" / "index.sqlite3") as connection:
            row = connection.execute(
                "SELECT chunk_id, title, text FROM index_chunks WHERE node_id = ?",
                ("node-1",),
            ).fetchone()
        assert row == ("node-1:0", "note", "# Hello\n\nIntegration body")
        assert (tmp_path / "parser" / "node-1" / "document.md").read_text(encoding="utf-8") == "# Hello\n\nIntegration body"
    finally:
        runtime.stop_index_worker()


def test_png_file_indexes_through_parser_queue_and_vector_store(
    tmp_path: Path,
    monkeypatch,
):
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    (source_dir / "photo.png").write_bytes(b"\x89PNG\r\n\x1a\n")

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
                    "coreConfig": {
                        "embedding": {
                            "provider": "local",
                            "local": {"model": "Alibaba-NLP/gte-multilingual-base"},
                        },
                        "reranker": {
                            "enabled": True,
                            "provider": "local",
                            "local": {"model": "Alibaba-NLP/gte-multilingual-reranker-base"},
                        },
                            "ocr": {
                                "provider": "local",
                                "local": {"model": "PaddlePaddle/PP-OCRv4_mobile"},
                            },
                        "caption": {
                            "provider": "local",
                            "local": {"model": "vikhyatk/moondream2"},
                        },
                        "providers": {
                            "huggingface": {"endpoint": "https://huggingface.co"},
                        },
                    },
                },
            }
        )
        runtime.start_index_worker()
        assert start_response["result"]["ok"] is True

        response = runtime.server.handle_request(
            {
                "id": "req-index-image",
                "method": "index_node",
                "params": {
                    "node": {
                        "nodeId": "node-image-1",
                        "mountId": "mount-1",
                        "name": "photo.png",
                        "sourceRef": "photo.png",
                        "providerType": "local",
                    },
                    "mount": {
                        "providerType": "local",
                        "syncedContentPath": "",
                        "localFilePath": str(source_dir / "photo.png"),
                    },
                },
            }
        )

        assert response == {"id": "req-index-image", "result": {"queued": True}}
        _wait_for(
            lambda: runtime.server.services.index_service.vector_status_snapshot()["chunkCount"]
            == 1
            and runtime.server.services.index_queue.snapshot()["phase"] == "idle",
            timeout_seconds=15.0,
        )

        artifact = (tmp_path / "parser" / "node-image-1" / "document.md").read_text(
            encoding="utf-8"
        )
        assert "Image caption:" in artifact
        assert "Image described caption" in artifact
        assert "Image OCR:" in artifact
        assert "Image described OCR text" in artifact

        search_payload = runtime.server.services.index_service.search("image described")
        assert any(
            result["nodeId"] == "node-image-1"
            for result in search_payload["debug"]["finalResults"]
        )
    finally:
        runtime.stop_index_worker()


def test_markdown_file_indexes_into_multiple_rows_through_parser_stack(
    tmp_path: Path,
    monkeypatch,
):
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    (source_dir / "note.md").write_text(
        "# Alpha\n\n"
        + ("Alpha body sentence. " * 60)
        + "\n\n## Beta\n\n"
        + ("Beta body sentence. " * 60),
        encoding="utf-8",
    )

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
                    "coreConfig": {
                        "embedding": {
                            "provider": "local",
                            "local": {"model": "Alibaba-NLP/gte-multilingual-base"},
                        },
                        "reranker": {
                            "enabled": True,
                            "provider": "local",
                            "local": {"model": "Alibaba-NLP/gte-multilingual-reranker-base"},
                        },
                            "ocr": {
                                "provider": "local",
                                "local": {"model": "PaddlePaddle/PP-OCRv4_mobile"},
                            },
                        "caption": {
                            "provider": "local",
                            "local": {"model": "vikhyatk/moondream2"},
                        },
                        "providers": {
                            "huggingface": {"endpoint": "https://huggingface.co"},
                        },
                    },
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
                        "nodeId": "node-multi",
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
            lambda: runtime.server.services.index_service.vector_status_snapshot()["chunkCount"] >= 2
            and runtime.server.services.index_queue.snapshot()["phase"] == "idle"
        )

        with sqlite3.connect(tmp_path / "index" / "index.sqlite3") as connection:
            rows = connection.execute(
                "SELECT chunk_id, text FROM index_chunks WHERE node_id = ? ORDER BY chunk_id",
                ("node-multi",),
            ).fetchall()

        assert len(rows) >= 2
        assert rows[0][0] == "node-multi:0"
        assert rows[0][1].startswith("# Alpha")
        assert any("## Beta" in row[1] for row in rows)
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


def test_index_service_logs_parse_and_embedding_stages(tmp_path: Path):
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    source_file = source_dir / "photo.png"
    source_file.write_bytes(b"\x89PNG\r\n\x1a\n")
    log_lines: list[str] = []

    class Buffer:
        def write(self, value: str) -> None:
            log_lines.append(value)

        def flush(self) -> None:
            return None

    model_store = ModelStatusStore(event_sink=lambda event: None)
    vector_store = VectorStatusStore(event_sink=lambda event: None)
    model_service = create_model_service(model_store)
    model_service.ensure_required_models()
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"))
    index_service = IndexService(
        parse_node=lambda node, mount: [
            {
                "status": "ok",
                "chunkIndex": 0,
                "text": "Image body",
                "title": "Photo",
                "source": {
                    "nodeId": node.node_id,
                    "name": node.name,
                    "path": mount.local_file_path,
                },
            }
        ],
        model_service=model_service,
        vector_repository=repository,
        vector_status_store=vector_store,
        parser_base_dir=tmp_path / "parser",
        logger=__import__("worker.runtime.logging", fromlist=["WorkerLogger"]).WorkerLogger(Buffer()),
    )

    index_service.index_node(
        IndexNodeRequest(
            node=ParserNode(
                node_id="node-image",
                mount_id="mount-1",
                name="photo.png",
                source_ref="photo.png",
                provider_type="local",
            ),
            mount=ParserMount(
                synced_content_path="",
                local_file_path=str(source_file),
                provider_type="local",
            ),
        )
    )

    records = [json.loads(line) for line in log_lines if line.strip()]
    messages = [record["msg"] for record in records]
    assert "index parse started" in messages
    assert "index parse finished" in messages
    assert "index embedding started" in messages
    assert "index embedding finished" in messages
    assert any(record.get("name") == "photo.png" for record in records)


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
                    "coreConfig": {
                        "embedding": {
                            "provider": "local",
                            "local": {"model": "Alibaba-NLP/gte-multilingual-base"},
                        },
                        "reranker": {
                            "enabled": True,
                            "provider": "local",
                            "local": {"model": "Alibaba-NLP/gte-multilingual-reranker-base"},
                        },
                            "ocr": {
                                "provider": "local",
                                "local": {"model": "PaddlePaddle/PP-OCRv4_mobile"},
                            },
                        "caption": {
                            "provider": "local",
                            "local": {"model": "vikhyatk/moondream2"},
                        },
                        "providers": {
                            "huggingface": {"endpoint": "https://huggingface.co"},
                        },
                    },
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
        with sqlite3.connect(tmp_path / "index" / "index.sqlite3") as connection:
            count = connection.execute("SELECT COUNT(*) FROM index_chunks").fetchone()[0]
        assert count == 2
    finally:
        runtime.stop_index_worker()


def test_index_worker_logs_traceback_when_job_fails(tmp_path: Path, monkeypatch):
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    (source_dir / "broken.md").write_text("broken", encoding="utf-8")

    monkeypatch.setenv("KNOWDISK_PYTHON_FAKE_MODEL_RUNTIME", "1")
    monkeypatch.setattr(
        "worker.runtime.bootstrap.parse_node",
        lambda node, mount, **kwargs: (_ for _ in ()).throw(RuntimeError("parse boom")),
    )
    stderr = io.StringIO()
    runtime = create_worker_runtime(
        stdin=io.BytesIO(),
        stdout=io.BytesIO(),
        stderr=stderr,
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
                "id": "req-index",
                "method": "index_node",
                "params": {
                    "node": {
                        "nodeId": "node-broken",
                        "mountId": "mount-1",
                        "name": "broken.md",
                        "sourceRef": "broken.md",
                        "providerType": "local",
                    },
                    "mount": {
                        "providerType": "local",
                        "syncedContentPath": "",
                        "localFilePath": str(source_dir / "broken.md"),
                    },
                },
            }
        )

        _wait_for(lambda: runtime.server.services.index_queue.snapshot()["phase"] == "idle")

        stderr_value = stderr.getvalue()
        assert '"msg":"index worker job failed"' in stderr_value
        assert '"error":"parse boom"' in stderr_value
        assert 'Traceback (most recent call last)' in stderr_value
    finally:
        runtime.stop_index_worker()


def create_model_service(status_store: ModelStatusStore) -> ModelService:
    class FakeArtifactManager:
        def resolve_model_root(self, kind: str, model: str) -> Path:
            return Path("/tmp") / Path(*model.split("/"))

        def ensure_artifacts(self, kind: str, model: str, force_redownload: bool = False, on_progress=None):
            _ = (kind, model, force_redownload, on_progress)
            return type("FakeArtifactResult", (), {"model_root": Path("/tmp"), "files": [], "downloaded_files": 0, "downloaded_bytes": 0})()

        def ensure_ocr_artifacts(self, runtime_config: ModelRuntimeConfig, force_redownload: bool = False, on_progress=None):
            _ = (runtime_config, force_redownload, on_progress)
            return type(
                "FakeOcrArtifactResult",
                (),
                {
                    "model_root": Path("/tmp/PaddlePaddle/PP-OCRv4_mobile"),
                    "detection_root": Path("/tmp/PaddlePaddle/PP-OCRv4_mobile_det"),
                    "recognition_root": Path("/tmp/PaddlePaddle/PP-OCRv4_mobile_rec"),
                    "layout_root": Path("/tmp/PaddlePaddle/PP-DocLayout_plus-L"),
                    "region_root": Path("/tmp/PaddlePaddle/PP-DocBlockLayout"),
                    "doc_orientation_root": Path("/tmp/PaddlePaddle/PP-LCNet_x1_0_doc_ori"),
                    "textline_orientation_root": Path("/tmp/PaddlePaddle/PP-LCNet_x1_0_textline_ori"),
                    "downloaded_files": 0,
                    "downloaded_bytes": 0,
                },
            )()

    service = ModelService(
        status_store=status_store,
        runtime_config=ModelRuntimeConfig(
            base_path=Path("/tmp"),
            embedding_model="Alibaba-NLP/gte-multilingual-base",
            reranker_model="Alibaba-NLP/gte-multilingual-reranker-base",
            ocr_model=DEFAULT_OCR_MODEL_DISPLAY,
            ocr_detection_model="PaddlePaddle/PP-OCRv4_mobile_det",
            ocr_recognition_model="PaddlePaddle/PP-OCRv4_mobile_rec",
            ocr_layout_model="PaddlePaddle/PP-DocLayout_plus-L",
            ocr_region_model="PaddlePaddle/PP-DocBlockLayout",
            ocr_doc_orientation_model="PaddlePaddle/PP-LCNet_x1_0_doc_ori",
            ocr_textline_orientation_model="PaddlePaddle/PP-LCNet_x1_0_textline_ori",
            caption_model="vikhyatk/moondream2",
            preferred_device="cpu",
            model_cache_dir=Path("/tmp/model"),
            huggingface_endpoint="https://hf.example",
        ),
        artifact_manager=FakeArtifactManager(),
        embedding_runtime_loader=lambda model_path, *, preferred_device: lambda text: [float(len(text))],
        reranker_runtime_loader=lambda model_path, *, preferred_device: {"provider": "stub-reranker"},
        ocr_runtime_loader=lambda model_path, *, preferred_device: object(),
        caption_runtime_loader=lambda model_path, *, preferred_device: object(),
    )
    assert service.ensure_required_models() == {"ok": True}
    return service


def _wait_for(predicate, timeout_seconds: float = 5.0) -> None:
    started = time.monotonic()
    while not predicate():
        if time.monotonic() - started > timeout_seconds:
            raise AssertionError("timed out waiting for background index worker")
        time.sleep(0.05)
