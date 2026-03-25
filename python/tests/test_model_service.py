from __future__ import annotations

from dataclasses import dataclass
from io import StringIO
from pathlib import Path
import threading
import time

from worker.model.types import LoadedRerankerRuntime, ModelRuntimeConfig
from worker.model.service import ModelService
from worker.runtime.logging import create_worker_logger
from worker.runtime.status import ModelStatusStore


@dataclass(frozen=True)
class FakeArtifactResult:
    model_root: Path
    files: list[str]
    downloaded_files: int
    downloaded_bytes: int


class FakeArtifactManager:
    def __init__(self, cache_root: Path, progress_steps: dict[str, list[tuple[int, int]]] | None = None):
        self.cache_root = cache_root
        self.progress_steps = progress_steps or {}
        self.calls: list[tuple[str, str, bool]] = []

    def resolve_model_root(self, kind: str, model: str) -> Path:
        return self.cache_root / kind / Path(*model.split("/"))

    def ensure_artifacts(
        self,
        kind: str,
        model: str,
        force_redownload: bool = False,
        on_progress=None,
    ) -> FakeArtifactResult:
        self.calls.append((kind, model, force_redownload))
        model_root = self.cache_root / kind / Path(*model.split("/"))
        model_root.mkdir(parents=True, exist_ok=True)

        for downloaded, total in self.progress_steps.get(kind, []):
            if on_progress is not None:
                on_progress(downloaded, total)

        return FakeArtifactResult(
            model_root=model_root,
            files=["config.json"],
            downloaded_files=1,
            downloaded_bytes=4,
        )


def write_complete_local_model_cache(kind: str, model_root: Path) -> None:
    model_root.mkdir(parents=True, exist_ok=True)
    (model_root / "config.json").write_text("{}", encoding="utf-8")
    if kind == "embedding":
        (model_root / "modules.json").write_text("[]", encoding="utf-8")
        (model_root / "1_Pooling").mkdir(parents=True, exist_ok=True)
        (model_root / "1_Pooling" / "config.json").write_text("{}", encoding="utf-8")
        (model_root / "model.safetensors").write_bytes(b"weights")
        return
    if kind == "ocr":
        (model_root / "preprocessor_config.json").write_text("{}", encoding="utf-8")
        (model_root / "processor_config.json").write_text("{}", encoding="utf-8")
        (model_root / "model.safetensors").write_bytes(b"weights")
        return
    if kind == "caption":
        (model_root / "processor_config.json").write_text("{}", encoding="utf-8")
        (model_root / "tokenizer.json").write_text("{}", encoding="utf-8")
        (model_root / "tokenizer_config.json").write_text("{}", encoding="utf-8")
        (model_root / "special_tokens_map.json").write_text("{}", encoding="utf-8")
        (model_root / "model.safetensors").write_bytes(b"weights")
        return
    (model_root / "pytorch_model.bin").write_bytes(b"weights")


def test_default_model_status_is_idle():
    emitted: list[dict] = []
    store = ModelStatusStore(event_sink=emitted.append)
    service = ModelService(status_store=store)

    assert service.snapshot()["phase"] == "idle"

def test_real_ensure_models_verifies_existing_local_model_by_successful_load(tmp_path: Path):
    emitted: list[dict] = []
    store = ModelStatusStore(event_sink=emitted.append)
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    embedding_root = manager.resolve_model_root("embedding", "Alibaba-NLP/gte-multilingual-base")
    reranker_root = manager.resolve_model_root("reranker", "Alibaba-NLP/gte-multilingual-reranker-base")
    ocr_root = manager.resolve_model_root("ocr", "PaddlePaddle/PaddleOCR-VL")
    caption_root = manager.resolve_model_root("caption", "vikhyatk/moondream2")
    write_complete_local_model_cache("embedding", embedding_root)
    write_complete_local_model_cache("reranker", reranker_root)
    write_complete_local_model_cache("ocr", ocr_root)
    write_complete_local_model_cache("caption", caption_root)
    embedding_runtime = object()
    reranker_tokenizer = object()
    reranker_model = object()
    ocr_runtime = object()
    caption_runtime = object()
    service = make_real_model_service(
        store,
        manager,
        embedding_loader=lambda model_path, *, preferred_device: embedding_runtime,
        reranker_loader=lambda model_path, *, preferred_device: (reranker_tokenizer, reranker_model),
        ocr_loader=lambda model_path, *, preferred_device: ocr_runtime,
        caption_loader=lambda model_path, *, preferred_device: caption_runtime,
    )

    result = service.ensure_required_models()

    assert result == {"ok": True}
    assert manager.calls == []
    assert service.snapshot()["phase"] == "completed"
    assert service.snapshot()["tasks"]["embedding"]["state"] == "ready"
    assert service.snapshot()["tasks"]["reranker"]["state"] == "ready"
    assert service.snapshot()["tasks"]["ocr"]["state"] == "ready"
    assert service.snapshot()["tasks"]["caption"]["state"] == "ready"
    assert service.get_local_embedding_runtime() is embedding_runtime
    reranker_runtime = service.get_local_reranker_runtime()
    assert isinstance(reranker_runtime, LoadedRerankerRuntime)
    assert reranker_runtime.tokenizer is reranker_tokenizer
    assert reranker_runtime.model is reranker_model
    assert service.get_local_ocr_runtime() is ocr_runtime
    assert service.get_local_caption_runtime() is caption_runtime


def test_real_ensure_models_downloads_missing_models_and_updates_progress(tmp_path: Path):
    emitted: list[dict] = []
    store = ModelStatusStore(event_sink=emitted.append)
    manager = FakeArtifactManager(
        cache_root=tmp_path / "cache",
        progress_steps={
            "embedding": [(2, 4), (4, 4)],
            "ocr": [(1, 4), (4, 4)],
        },
    )
    service = make_real_model_service(
        store,
        manager,
        embedding_loader=lambda model_path, *, preferred_device: object(),
        reranker_loader=lambda model_path, *, preferred_device: ("tok", "model"),
        ocr_loader=lambda model_path, *, preferred_device: object(),
        caption_loader=lambda model_path, *, preferred_device: object(),
    )

    result = service.ensure_required_models()

    assert result == {"ok": True}
    assert manager.calls == [
        ("embedding", "Alibaba-NLP/gte-multilingual-base", False),
        ("reranker", "Alibaba-NLP/gte-multilingual-reranker-base", False),
        ("ocr", "PaddlePaddle/PaddleOCR-VL", False),
        ("caption", "vikhyatk/moondream2", False),
    ]
    assert any(
        event["payload"]["phase"] == "running"
        and event["payload"]["tasks"]["embedding"]["state"] == "downloading"
        and event["payload"]["tasks"]["embedding"]["model"] == "Alibaba-NLP/gte-multilingual-base"
        and event["payload"]["tasks"]["embedding"]["progressPct"] > 0
        for event in emitted
    )
    assert any(
        event["payload"]["phase"] == "running"
        and event["payload"]["tasks"]["ocr"]["state"] == "downloading"
        and event["payload"]["tasks"]["ocr"]["model"] == "PaddlePaddle/PaddleOCR-VL"
        and event["payload"]["tasks"]["ocr"]["progressPct"] > 0
        for event in emitted
    )
    assert service.snapshot()["phase"] == "completed"


def test_real_ensure_models_marks_failed_when_verify_by_load_fails(tmp_path: Path):
    emitted: list[dict] = []
    store = ModelStatusStore(event_sink=emitted.append)
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    write_complete_local_model_cache(
        "embedding", manager.resolve_model_root("embedding", "Alibaba-NLP/gte-multilingual-base")
    )
    write_complete_local_model_cache(
        "reranker", manager.resolve_model_root("reranker", "Alibaba-NLP/gte-multilingual-reranker-base")
    )
    write_complete_local_model_cache("ocr", manager.resolve_model_root("ocr", "PaddlePaddle/PaddleOCR-VL"))
    write_complete_local_model_cache("caption", manager.resolve_model_root("caption", "vikhyatk/moondream2"))
    service = make_real_model_service(
        store,
        manager,
        embedding_loader=lambda model_path, *, preferred_device: (_ for _ in ()).throw(RuntimeError("boom")),
        reranker_loader=lambda model_path, *, preferred_device: ("tok", "model"),
        ocr_loader=lambda model_path, *, preferred_device: object(),
        caption_loader=lambda model_path, *, preferred_device: object(),
    )

    result = service.ensure_required_models()

    assert result == {"ok": False}
    assert service.snapshot()["phase"] == "failed"
    assert service.snapshot()["error"] == "boom"
    assert service.snapshot()["tasks"]["embedding"]["state"] == "failed"
    assert manager.calls == [("embedding", "Alibaba-NLP/gte-multilingual-base", True)]


def test_real_ensure_models_logs_cached_runtime_load_failures_before_redownload(tmp_path: Path):
    store = ModelStatusStore(event_sink=lambda event: None)
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    embedding_root = manager.resolve_model_root("embedding", "Alibaba-NLP/gte-multilingual-base")
    write_complete_local_model_cache("embedding", embedding_root)
    logger_stream = StringIO()
    service = make_real_model_service(
        store,
        manager,
        embedding_loader=lambda model_path, *, preferred_device: (_ for _ in ()).throw(RuntimeError("boom")),
        reranker_loader=lambda model_path, *, preferred_device: ("tok", "model"),
        ocr_loader=lambda model_path, *, preferred_device: object(),
        caption_loader=lambda model_path, *, preferred_device: object(),
        logger=create_worker_logger(logger_stream),
    )

    result = service.ensure_required_models()

    assert result == {"ok": False}
    assert '"msg":"failed to load cached model runtime, falling back to download"' in logger_stream.getvalue()
    assert '"kind":"embedding"' in logger_stream.getvalue()
    assert '"error":"boom"' in logger_stream.getvalue()


def test_real_ensure_models_logs_model_name_when_task_fails(tmp_path: Path):
    store = ModelStatusStore(event_sink=lambda event: None)
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    logger_stream = StringIO()
    service = make_real_model_service(
        store,
        manager,
        embedding_loader=lambda model_path, *, preferred_device: (_ for _ in ()).throw(RuntimeError("boom")),
        reranker_loader=lambda model_path, *, preferred_device: ("tok", "model"),
        ocr_loader=lambda model_path, *, preferred_device: object(),
        caption_loader=lambda model_path, *, preferred_device: object(),
        logger=create_worker_logger(logger_stream),
    )

    assert service.ensure_required_models() == {"ok": False}
    assert '"msg":"model task failed"' in logger_stream.getvalue()
    assert '"kind":"embedding"' in logger_stream.getvalue()
    assert '"model":"Alibaba-NLP/gte-multilingual-base"' in logger_stream.getvalue()


def test_real_ensure_models_redownloads_partial_embedding_cache_before_loading(tmp_path: Path):
    store = ModelStatusStore(event_sink=lambda event: None)
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    embedding_root = manager.resolve_model_root("embedding", "Alibaba-NLP/gte-multilingual-base")
    embedding_root.mkdir(parents=True, exist_ok=True)
    (embedding_root / "config.json").write_text("{}", encoding="utf-8")
    (embedding_root / "model.safetensors.part").write_bytes(b"partial")

    embedding_loader_calls: list[Path] = []
    service = make_real_model_service(
        store,
        manager,
        embedding_loader=lambda model_path, *, preferred_device: (
            embedding_loader_calls.append(model_path) or object()
        ),
        reranker_loader=lambda model_path, *, preferred_device: ("tok", "model"),
        ocr_loader=lambda model_path, *, preferred_device: object(),
        caption_loader=lambda model_path, *, preferred_device: object(),
    )

    result = service.ensure_required_models()

    assert result == {"ok": True}
    assert manager.calls[0] == ("embedding", "Alibaba-NLP/gte-multilingual-base", False)
    assert embedding_loader_calls == [embedding_root]


def test_real_ensure_models_completes_missing_files_without_forcing_redownload(tmp_path: Path):
    store = ModelStatusStore(event_sink=lambda event: None)
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    embedding_root = manager.resolve_model_root("embedding", "Alibaba-NLP/gte-multilingual-base")
    embedding_root.mkdir(parents=True, exist_ok=True)
    (embedding_root / "config.json").write_text("{}", encoding="utf-8")

    service = make_real_model_service(
        store,
        manager,
        embedding_loader=lambda model_path, *, preferred_device: object(),
        reranker_loader=lambda model_path, *, preferred_device: ("tok", "model"),
        ocr_loader=lambda model_path, *, preferred_device: object(),
        caption_loader=lambda model_path, *, preferred_device: object(),
    )

    result = service.ensure_required_models()

    assert result == {"ok": True}
    assert manager.calls[0] == ("embedding", "Alibaba-NLP/gte-multilingual-base", False)


def test_real_ensure_models_marks_only_reranker_failed_when_reranker_load_fails(tmp_path: Path):
    emitted: list[dict] = []
    store = ModelStatusStore(event_sink=emitted.append)
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    write_complete_local_model_cache(
        "embedding", manager.resolve_model_root("embedding", "Alibaba-NLP/gte-multilingual-base")
    )
    write_complete_local_model_cache(
        "reranker", manager.resolve_model_root("reranker", "Alibaba-NLP/gte-multilingual-reranker-base")
    )
    write_complete_local_model_cache("ocr", manager.resolve_model_root("ocr", "PaddlePaddle/PaddleOCR-VL"))
    write_complete_local_model_cache("caption", manager.resolve_model_root("caption", "vikhyatk/moondream2"))
    service = make_real_model_service(
        store,
        manager,
        embedding_loader=lambda model_path, *, preferred_device: object(),
        reranker_loader=lambda model_path, *, preferred_device: (_ for _ in ()).throw(RuntimeError("reranker boom")),
        ocr_loader=lambda model_path, *, preferred_device: object(),
        caption_loader=lambda model_path, *, preferred_device: object(),
    )

    result = service.ensure_required_models()

    assert result == {"ok": False}
    assert service.snapshot()["phase"] == "failed"
    assert service.snapshot()["tasks"]["embedding"]["state"] == "ready"
    assert service.snapshot()["tasks"]["reranker"]["state"] == "failed"
    assert service.snapshot()["error"] == "reranker boom"
    assert manager.calls == [("reranker", "Alibaba-NLP/gte-multilingual-reranker-base", True)]


def test_embedding_runtime_is_cached(tmp_path: Path):
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    embedding_runtime = object()
    service = make_real_model_service(
        ModelStatusStore(event_sink=lambda event: None),
        manager,
        embedding_loader=lambda model_path, *, preferred_device: embedding_runtime,
        reranker_loader=lambda model_path, *, preferred_device: ("tok", "model"),
        ocr_loader=lambda model_path, *, preferred_device: object(),
        caption_loader=lambda model_path, *, preferred_device: object(),
    )

    assert service.ensure_required_models() == {"ok": True}
    first = service.get_local_embedding_runtime()
    second = service.get_local_embedding_runtime()

    assert first is embedding_runtime
    assert second is embedding_runtime
    assert manager.calls == [
        ("embedding", "Alibaba-NLP/gte-multilingual-base", False),
        ("reranker", "Alibaba-NLP/gte-multilingual-reranker-base", False),
        ("ocr", "PaddlePaddle/PaddleOCR-VL", False),
        ("caption", "vikhyatk/moondream2", False),
    ]


def test_reranker_runtime_is_cached_as_named_runtime(tmp_path: Path):
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    tokenizer = object()
    model = object()
    service = make_real_model_service(
        ModelStatusStore(event_sink=lambda event: None),
        manager,
        embedding_loader=lambda model_path, *, preferred_device: object(),
        reranker_loader=lambda model_path, *, preferred_device: (tokenizer, model),
        ocr_loader=lambda model_path, *, preferred_device: object(),
        caption_loader=lambda model_path, *, preferred_device: object(),
    )

    assert service.ensure_required_models() == {"ok": True}
    first = service.get_local_reranker_runtime()
    second = service.get_local_reranker_runtime()

    assert first is second
    assert isinstance(first, LoadedRerankerRuntime)
    assert first.tokenizer is tokenizer
    assert first.model is model
    assert manager.calls == [
        ("embedding", "Alibaba-NLP/gte-multilingual-base", False),
        ("reranker", "Alibaba-NLP/gte-multilingual-reranker-base", False),
        ("ocr", "PaddlePaddle/PaddleOCR-VL", False),
        ("caption", "vikhyatk/moondream2", False),
    ]


def test_ocr_and_caption_runtimes_are_verified_and_cached(tmp_path: Path):
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    ocr_runtime = object()
    caption_runtime = object()
    write_complete_local_model_cache(
        "ocr", manager.resolve_model_root("ocr", "PaddlePaddle/PaddleOCR-VL")
    )
    write_complete_local_model_cache(
        "caption", manager.resolve_model_root("caption", "vikhyatk/moondream2")
    )
    service = make_real_model_service(
        ModelStatusStore(event_sink=lambda event: None),
        manager,
        embedding_loader=lambda model_path, *, preferred_device: object(),
        reranker_loader=lambda model_path, *, preferred_device: ("tok", "model"),
        ocr_loader=lambda model_path, *, preferred_device: ocr_runtime,
        caption_loader=lambda model_path, *, preferred_device: caption_runtime,
    )

    assert service.get_local_ocr_runtime() is ocr_runtime
    assert service.get_local_caption_runtime() is caption_runtime
    assert manager.calls == []


def test_get_local_embedding_runtime_waits_for_inflight_verify(tmp_path: Path):
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    store = ModelStatusStore(event_sink=lambda event: None)
    loader_started = threading.Event()
    release_loader = threading.Event()
    embedding_runtime = object()
    service = make_real_model_service(
        store,
        manager,
        embedding_loader=lambda model_path, *, preferred_device: (
            loader_started.set(),
            release_loader.wait(1),
            embedding_runtime,
        )[-1],
        reranker_loader=lambda model_path, *, preferred_device: ("tok", "model"),
        ocr_loader=lambda model_path, *, preferred_device: object(),
        caption_loader=lambda model_path, *, preferred_device: object(),
    )

    ensure_thread = threading.Thread(target=service.ensure_required_models)
    ensure_thread.start()
    assert loader_started.wait(0.5)

    result: list[object] = []
    getter_done = threading.Event()

    def read_runtime() -> None:
        result.append(service.get_local_embedding_runtime())
        getter_done.set()

    getter_thread = threading.Thread(target=read_runtime)
    getter_thread.start()
    time.sleep(0.05)
    assert getter_done.is_set() is False

    release_loader.set()
    getter_thread.join(timeout=1)
    ensure_thread.join(timeout=1)

    assert getter_done.is_set() is True
    assert result == [embedding_runtime]


def test_get_local_embedding_runtime_raises_when_runtime_failed(tmp_path: Path):
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    service = make_real_model_service(
        ModelStatusStore(event_sink=lambda event: None),
        manager,
        embedding_loader=lambda model_path, *, preferred_device: (_ for _ in ()).throw(RuntimeError("boom")),
        reranker_loader=lambda model_path, *, preferred_device: ("tok", "model"),
        ocr_loader=lambda model_path, *, preferred_device: object(),
        caption_loader=lambda model_path, *, preferred_device: object(),
    )

    assert service.ensure_required_models() == {"ok": False}
    try:
        service.get_local_embedding_runtime()
    except RuntimeError as error:
        assert str(error) == "boom"
    else:
        raise AssertionError("expected get_local_embedding_runtime to raise after failed verify")


def test_get_local_ocr_runtime_raises_when_runtime_failed(tmp_path: Path):
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    service = make_real_model_service(
        ModelStatusStore(event_sink=lambda event: None),
        manager,
        embedding_loader=lambda model_path, *, preferred_device: object(),
        reranker_loader=lambda model_path, *, preferred_device: ("tok", "model"),
        ocr_loader=lambda model_path, *, preferred_device: (_ for _ in ()).throw(RuntimeError("ocr boom")),
        caption_loader=lambda model_path, *, preferred_device: object(),
    )

    assert service.ensure_required_models() == {"ok": False}
    assert service.snapshot()["tasks"]["ocr"]["state"] == "failed"
    try:
        service.get_local_ocr_runtime()
    except RuntimeError as error:
        assert str(error) == "ocr boom"
    else:
        raise AssertionError("expected get_local_ocr_runtime to raise after failed verify")


def make_real_model_service(
    status_store: ModelStatusStore,
    artifact_manager: FakeArtifactManager,
    *,
    embedding_loader,
    reranker_loader,
    ocr_loader,
    caption_loader,
    logger=None,
) -> ModelService:
    return ModelService(
        status_store=status_store,
        runtime_config=ModelRuntimeConfig(
            base_path=artifact_manager.cache_root.parent,
            embedding_model="Alibaba-NLP/gte-multilingual-base",
            reranker_model="Alibaba-NLP/gte-multilingual-reranker-base",
            ocr_model="PaddlePaddle/PaddleOCR-VL",
            caption_model="vikhyatk/moondream2",
            preferred_device="cpu",
            model_cache_dir=artifact_manager.cache_root,
            huggingface_endpoint="https://hf.example",
        ),
        artifact_manager=artifact_manager,
        embedding_runtime_loader=embedding_loader,
        reranker_runtime_loader=reranker_loader,
        ocr_runtime_loader=ocr_loader,
        caption_runtime_loader=caption_loader,
        logger=logger,
    )
