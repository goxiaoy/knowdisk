from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from worker.model.types import LoadedRerankerRuntime, ModelRuntimeConfig
from worker.model.service import ModelService
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


def test_default_model_status_is_idle():
    emitted: list[dict] = []
    store = ModelStatusStore(event_sink=emitted.append)
    service = ModelService(
        status_store=store,
        verify_embedding=lambda: None,
        verify_reranker=lambda: None,
        load_embedding_runtime=lambda: object(),
        load_reranker_runtime=lambda: object(),
    )

    assert service.snapshot()["phase"] == "idle"


def test_legacy_ensure_models_marks_tasks_ready():
    emitted: list[dict] = []
    store = ModelStatusStore(event_sink=emitted.append)
    service = ModelService(
        status_store=store,
        verify_embedding=lambda: None,
        verify_reranker=lambda: None,
        load_embedding_runtime=lambda: object(),
        load_reranker_runtime=lambda: object(),
    )

    result = service.ensure_required_models()

    assert result == {"ok": True}
    assert service.snapshot()["phase"] == "completed"
    assert service.snapshot()["tasks"]["embedding"]["state"] == "ready"
    assert service.snapshot()["tasks"]["reranker"]["state"] == "ready"


def test_legacy_download_failure_updates_model_status():
    emitted: list[dict] = []
    store = ModelStatusStore(event_sink=emitted.append)

    def fail() -> None:
        raise RuntimeError("download failed")

    service = ModelService(
        status_store=store,
        verify_embedding=fail,
        verify_reranker=lambda: None,
        load_embedding_runtime=lambda: object(),
        load_reranker_runtime=lambda: object(),
    )

    result = service.ensure_required_models()

    assert result == {"ok": False}
    assert service.snapshot()["phase"] == "failed"
    assert service.snapshot()["error"] == "download failed"


def test_real_ensure_models_verifies_existing_local_model_by_successful_load(tmp_path: Path):
    emitted: list[dict] = []
    store = ModelStatusStore(event_sink=emitted.append)
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    embedding_root = manager.resolve_model_root("embedding", "Alibaba-NLP/gte-multilingual-base")
    reranker_root = manager.resolve_model_root("reranker", "Alibaba-NLP/gte-multilingual-reranker-base")
    embedding_root.mkdir(parents=True, exist_ok=True)
    reranker_root.mkdir(parents=True, exist_ok=True)
    embedding_runtime = object()
    reranker_tokenizer = object()
    reranker_model = object()
    service = make_real_model_service(
        store,
        manager,
        embedding_loader=lambda model_path, *, preferred_device: embedding_runtime,
        reranker_loader=lambda model_path, *, preferred_device: (reranker_tokenizer, reranker_model),
    )

    result = service.ensure_required_models()

    assert result == {"ok": True}
    assert manager.calls == []
    assert service.snapshot()["phase"] == "completed"
    assert service.snapshot()["tasks"]["embedding"]["state"] == "ready"
    assert service.snapshot()["tasks"]["reranker"]["state"] == "ready"
    assert service.get_local_embedding_runtime() is embedding_runtime
    reranker_runtime = service.get_local_reranker_runtime()
    assert isinstance(reranker_runtime, LoadedRerankerRuntime)
    assert reranker_runtime.tokenizer is reranker_tokenizer
    assert reranker_runtime.model is reranker_model


def test_real_ensure_models_downloads_missing_models_and_updates_progress(tmp_path: Path):
    emitted: list[dict] = []
    store = ModelStatusStore(event_sink=emitted.append)
    manager = FakeArtifactManager(
        cache_root=tmp_path / "cache",
        progress_steps={
            "embedding": [(2, 4), (4, 4)],
        },
    )
    service = make_real_model_service(
        store,
        manager,
        embedding_loader=lambda model_path, *, preferred_device: object(),
        reranker_loader=lambda model_path, *, preferred_device: ("tok", "model"),
    )

    result = service.ensure_required_models()

    assert result == {"ok": True}
    assert any(
        event["payload"]["phase"] == "running"
        and event["payload"]["tasks"]["embedding"]["state"] == "downloading"
        and event["payload"]["tasks"]["embedding"]["model"] == "Alibaba-NLP/gte-multilingual-base"
        and event["payload"]["tasks"]["embedding"]["progressPct"] > 0
        for event in emitted
    )
    assert service.snapshot()["phase"] == "completed"


def test_real_ensure_models_marks_failed_when_verify_by_load_fails(tmp_path: Path):
    emitted: list[dict] = []
    store = ModelStatusStore(event_sink=emitted.append)
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    manager.resolve_model_root("embedding", "Alibaba-NLP/gte-multilingual-base").mkdir(
        parents=True, exist_ok=True
    )
    manager.resolve_model_root("reranker", "Alibaba-NLP/gte-multilingual-reranker-base").mkdir(
        parents=True, exist_ok=True
    )
    service = make_real_model_service(
        store,
        manager,
        embedding_loader=lambda model_path, *, preferred_device: (_ for _ in ()).throw(RuntimeError("boom")),
        reranker_loader=lambda model_path, *, preferred_device: ("tok", "model"),
    )

    result = service.ensure_required_models()

    assert result == {"ok": False}
    assert service.snapshot()["phase"] == "failed"
    assert service.snapshot()["error"] == "boom"
    assert service.snapshot()["tasks"]["embedding"]["state"] == "failed"
    assert manager.calls == [("embedding", "Alibaba-NLP/gte-multilingual-base", True)]


def test_real_ensure_models_marks_only_reranker_failed_when_reranker_load_fails(tmp_path: Path):
    emitted: list[dict] = []
    store = ModelStatusStore(event_sink=emitted.append)
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    manager.resolve_model_root("embedding", "Alibaba-NLP/gte-multilingual-base").mkdir(
        parents=True, exist_ok=True
    )
    manager.resolve_model_root("reranker", "Alibaba-NLP/gte-multilingual-reranker-base").mkdir(
        parents=True, exist_ok=True
    )
    service = make_real_model_service(
        store,
        manager,
        embedding_loader=lambda model_path, *, preferred_device: object(),
        reranker_loader=lambda model_path, *, preferred_device: (_ for _ in ()).throw(RuntimeError("reranker boom")),
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
    )

    first = service.get_local_embedding_runtime()
    second = service.get_local_embedding_runtime()

    assert first is embedding_runtime
    assert second is embedding_runtime
    assert manager.calls == [("embedding", "Alibaba-NLP/gte-multilingual-base", False)]


def test_reranker_runtime_is_cached_as_named_runtime(tmp_path: Path):
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    tokenizer = object()
    model = object()
    service = make_real_model_service(
        ModelStatusStore(event_sink=lambda event: None),
        manager,
        embedding_loader=lambda model_path, *, preferred_device: object(),
        reranker_loader=lambda model_path, *, preferred_device: (tokenizer, model),
    )

    first = service.get_local_reranker_runtime()
    second = service.get_local_reranker_runtime()

    assert first is second
    assert isinstance(first, LoadedRerankerRuntime)
    assert first.tokenizer is tokenizer
    assert first.model is model
    assert manager.calls == [("reranker", "Alibaba-NLP/gte-multilingual-reranker-base", False)]


def make_real_model_service(
    status_store: ModelStatusStore,
    artifact_manager: FakeArtifactManager,
    *,
    embedding_loader,
    reranker_loader,
) -> ModelService:
    return ModelService(
        status_store=status_store,
        verify_embedding=lambda: None,
        verify_reranker=lambda: None,
        load_embedding_runtime=lambda: object(),
        load_reranker_runtime=lambda: object(),
        runtime_config=ModelRuntimeConfig(
            base_path=artifact_manager.cache_root.parent,
            embedding_model="Alibaba-NLP/gte-multilingual-base",
            reranker_model="Alibaba-NLP/gte-multilingual-reranker-base",
            preferred_device="cpu",
            model_cache_dir=artifact_manager.cache_root,
            huggingface_endpoint="https://hf.example",
        ),
        artifact_manager=artifact_manager,
        embedding_runtime_loader=embedding_loader,
        reranker_runtime_loader=reranker_loader,
    )
