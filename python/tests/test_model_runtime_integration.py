from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path

from worker.model.types import DEFAULT_OCR_MODEL_DISPLAY, LoadedRerankerRuntime, ModelRuntimeConfig
from worker.model.model_specs import resolve_ocr_preset
from worker.model.service import ModelService
from worker.runtime.status import ModelStatusStore


@dataclass(frozen=True)
class FakeArtifactResult:
    model_root: Path
    files: list[str]
    downloaded_files: int
    downloaded_bytes: int


@dataclass(frozen=True)
class FakeOcrArtifactResult:
    model_root: Path
    detection_root: Path
    recognition_root: Path
    layout_root: Path
    region_root: Path
    doc_orientation_root: Path
    textline_orientation_root: Path
    downloaded_files: int
    downloaded_bytes: int


class FakeArtifactManager:
    def __init__(self, cache_root: Path, progress_steps: dict[str, list[tuple[int, int]]] | None = None):
        self.cache_root = cache_root
        self.progress_steps = progress_steps or {}
        self.calls: list[tuple[str, str, bool]] = []

    def resolve_model_root(self, kind: str, model: str) -> Path:
        return self.cache_root / Path(*model.split("/"))

    def ensure_artifacts(
        self,
        kind: str,
        model: str,
        force_redownload: bool = False,
        on_progress=None,
    ) -> FakeArtifactResult:
        self.calls.append((kind, model, force_redownload))
        model_root = self.resolve_model_root(kind, model)
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

    def ensure_ocr_artifacts(
        self,
        runtime_config: ModelRuntimeConfig,
        force_redownload: bool = False,
        on_progress=None,
    ) -> FakeOcrArtifactResult:
        self.calls.append(("ocr-bundle", runtime_config.ocr_model, force_redownload))
        detection_root = self.resolve_model_root("ocr", runtime_config.ocr_detection_model)
        recognition_root = self.resolve_model_root("ocr", runtime_config.ocr_recognition_model)
        layout_root = self.resolve_model_root("ocr", runtime_config.ocr_layout_model)
        region_root = self.resolve_model_root("ocr", runtime_config.ocr_region_model)
        doc_orientation_root = self.resolve_model_root("ocr", runtime_config.ocr_doc_orientation_model)
        textline_orientation_root = self.resolve_model_root("ocr", runtime_config.ocr_textline_orientation_model)
        for root in (
            detection_root,
            recognition_root,
            layout_root,
            region_root,
            doc_orientation_root,
            textline_orientation_root,
        ):
            root.mkdir(parents=True, exist_ok=True)
            (root / "config.json").write_text("{}", encoding="utf-8")
            (root / "model.safetensors").write_bytes(b"weights")
        for downloaded, total in self.progress_steps.get("ocr", []):
            if on_progress is not None:
                on_progress(downloaded, total)

        return FakeOcrArtifactResult(
            model_root=self.resolve_model_root("ocr", runtime_config.ocr_model),
            detection_root=detection_root,
            recognition_root=recognition_root,
            layout_root=layout_root,
            region_root=region_root,
            doc_orientation_root=doc_orientation_root,
            textline_orientation_root=textline_orientation_root,
            downloaded_files=6,
            downloaded_bytes=24,
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
        cache_root = model_root.parents[1]
        for model in resolve_ocr_preset(DEFAULT_OCR_MODEL_DISPLAY).values():
            component_root = cache_root / Path(*model.split("/"))
            component_root.mkdir(parents=True, exist_ok=True)
            (component_root / "config.json").write_text("{}", encoding="utf-8")
            (component_root / "model.safetensors").write_bytes(b"weights")
        return
    if kind == "caption":
        (model_root / "processor_config.json").write_text("{}", encoding="utf-8")
        (model_root / "tokenizer.json").write_text("{}", encoding="utf-8")
        (model_root / "tokenizer_config.json").write_text("{}", encoding="utf-8")
        (model_root / "special_tokens_map.json").write_text("{}", encoding="utf-8")
        (model_root / "model.safetensors").write_bytes(b"weights")
        return
    (model_root / "pytorch_model.bin").write_bytes(b"weights")


def test_local_cache_verify_path_uses_existing_files_without_downloading(tmp_path: Path):
    emitted: list[dict] = []
    store = ModelStatusStore(event_sink=emitted.append)
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    write_complete_local_model_cache(
        "embedding", manager.resolve_model_root("embedding", "Alibaba-NLP/gte-multilingual-base")
    )
    write_complete_local_model_cache(
        "reranker", manager.resolve_model_root("reranker", "Alibaba-NLP/gte-multilingual-reranker-base")
    )
    write_complete_local_model_cache("ocr", manager.resolve_model_root("ocr", DEFAULT_OCR_MODEL_DISPLAY))
    write_complete_local_model_cache("caption", manager.resolve_model_root("caption", "vikhyatk/moondream2"))

    embedding_runtime = object()
    reranker_tokenizer = object()
    reranker_model = object()
    service = make_model_service(
        store,
        manager,
        embedding_loader=lambda model_path, *, preferred_device: embedding_runtime,
        reranker_loader=lambda model_path, *, preferred_device: (reranker_tokenizer, reranker_model),
    )

    result = service.ensure_required_models()

    assert result == {"ok": True}
    assert manager.calls == []
    assert phases(emitted)[0] == "verifying"
    assert phases(emitted)[-1] == "completed"
    assert phases(emitted).count("verifying") >= 4
    assert emitted[0]["payload"]["tasks"]["embedding"]["state"] == "waiting"
    assert emitted[0]["payload"]["tasks"]["reranker"]["state"] == "waiting"
    assert emitted[1]["payload"]["tasks"]["embedding"]["state"] == "verifying"
    assert emitted[1]["payload"]["tasks"]["reranker"]["state"] == "waiting"
    assert emitted[2]["payload"]["tasks"]["embedding"]["state"] == "ready"
    assert emitted[2]["payload"]["tasks"]["reranker"]["state"] == "waiting"
    assert emitted[3]["payload"]["tasks"]["embedding"]["state"] == "ready"
    assert emitted[3]["payload"]["tasks"]["reranker"]["state"] == "verifying"
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


def test_missing_cache_download_path_fetches_and_marks_ready(tmp_path: Path):
    emitted: list[dict] = []
    store = ModelStatusStore(event_sink=emitted.append)
    manager = FakeArtifactManager(
        cache_root=tmp_path / "cache",
        progress_steps={
            "embedding": [(2, 4), (4, 4)],
            "reranker": [(1, 4), (4, 4)],
            "ocr": [(1, 4), (4, 4)],
            "caption": [(2, 4), (4, 4)],
        },
    )
    service = make_model_service(
        store,
        manager,
        embedding_loader=lambda model_path, *, preferred_device: object(),
        reranker_loader=lambda model_path, *, preferred_device: ("tok", "model"),
    )

    result = service.ensure_required_models()

    assert result == {"ok": True}
    assert manager.calls == [
        ("embedding", "Alibaba-NLP/gte-multilingual-base", False),
        ("reranker", "Alibaba-NLP/gte-multilingual-reranker-base", False),
        ("ocr-bundle", DEFAULT_OCR_MODEL_DISPLAY, False),
        ("caption", "vikhyatk/moondream2", False),
    ]
    assert phases(emitted)[0] == "verifying"
    assert emitted[0]["payload"]["tasks"]["embedding"]["state"] == "waiting"
    assert emitted[0]["payload"]["tasks"]["reranker"]["state"] == "waiting"
    assert any(
        event["payload"]["tasks"]["embedding"]["state"] == "verifying"
        and event["payload"]["tasks"]["reranker"]["state"] == "waiting"
        for event in emitted
    )
    assert any(
        event["payload"]["tasks"]["embedding"]["state"] == "ready"
        and event["payload"]["tasks"]["reranker"]["state"] == "verifying"
        for event in emitted
    )
    assert "running" in phases(emitted)
    assert phases(emitted)[-1] == "completed"
    assert service.snapshot()["phase"] == "completed"
    assert service.snapshot()["tasks"]["embedding"]["state"] == "ready"
    assert service.snapshot()["tasks"]["reranker"]["state"] == "ready"
    assert service.snapshot()["tasks"]["ocr"]["state"] == "ready"
    assert service.snapshot()["tasks"]["caption"]["state"] == "ready"
    assert service.snapshot()["progressPct"] == 100
    assert service.snapshot()["available"] is True


def test_failed_load_path_marks_only_the_failing_model_failed(tmp_path: Path):
    emitted: list[dict] = []
    store = ModelStatusStore(event_sink=emitted.append)
    manager = FakeArtifactManager(cache_root=tmp_path / "cache")
    write_complete_local_model_cache(
        "embedding", manager.resolve_model_root("embedding", "Alibaba-NLP/gte-multilingual-base")
    )
    write_complete_local_model_cache(
        "reranker", manager.resolve_model_root("reranker", "Alibaba-NLP/gte-multilingual-reranker-base")
    )
    embedding_loader_calls: list[Path] = []

    def fail_embedding_loader(model_path: Path, *, preferred_device: str):
        embedding_loader_calls.append(model_path)
        raise RuntimeError("embedding boom")

    service = make_model_service(
        store,
        manager,
        embedding_loader=fail_embedding_loader,
        reranker_loader=lambda model_path, *, preferred_device: ("tok", "model"),
    )

    result = service.ensure_required_models()

    assert result == {"ok": False}
    assert embedding_loader_calls == [manager.resolve_model_root("embedding", "Alibaba-NLP/gte-multilingual-base")]
    assert manager.calls == []
    assert phases(emitted)[0] == "verifying"
    assert phases(emitted)[-1] == "failed"
    assert service.snapshot()["phase"] == "failed"
    assert service.snapshot()["tasks"]["embedding"]["state"] == "failed"
    assert service.snapshot()["tasks"]["reranker"]["state"] == "waiting"
    assert service.snapshot()["error"] == "embedding boom"


def test_model_status_transitions_cover_success_and_failure_paths(tmp_path: Path):
    success_emitted: list[dict] = []
    success_service = make_model_service(
        ModelStatusStore(event_sink=success_emitted.append),
        FakeArtifactManager(cache_root=tmp_path / "success-cache"),
        embedding_loader=lambda model_path, *, preferred_device: object(),
        reranker_loader=lambda model_path, *, preferred_device: ("tok", "model"),
    )
    assert success_service.ensure_required_models() == {"ok": True}
    assert phases(success_emitted)[0] == "verifying"
    assert success_emitted[0]["payload"]["tasks"]["embedding"]["state"] == "waiting"
    assert success_emitted[0]["payload"]["tasks"]["reranker"]["state"] == "waiting"
    assert any(
        event["payload"]["tasks"]["embedding"]["state"] == "verifying"
        and event["payload"]["tasks"]["reranker"]["state"] == "waiting"
        for event in success_emitted
    )
    assert any(
        event["payload"]["tasks"]["embedding"]["state"] == "ready"
        and event["payload"]["tasks"]["reranker"]["state"] == "verifying"
        for event in success_emitted
    )
    assert phases(success_emitted)[-1] == "completed"
    assert "running" in phases(success_emitted)
    assert phases(success_emitted).count("verifying") >= 2

    failure_emitted: list[dict] = []
    failure_manager = FakeArtifactManager(cache_root=tmp_path / "failure-cache")
    write_complete_local_model_cache(
        "embedding", failure_manager.resolve_model_root("embedding", "Alibaba-NLP/gte-multilingual-base")
    )
    write_complete_local_model_cache(
        "reranker", failure_manager.resolve_model_root("reranker", "Alibaba-NLP/gte-multilingual-reranker-base")
    )
    failure_service = make_model_service(
        ModelStatusStore(event_sink=failure_emitted.append),
        failure_manager,
        embedding_loader=lambda model_path, *, preferred_device: (_ for _ in ()).throw(RuntimeError("boom")),
        reranker_loader=lambda model_path, *, preferred_device: ("tok", "model"),
    )
    assert failure_service.ensure_required_models() == {"ok": False}
    assert phases(failure_emitted)[0] == "verifying"
    assert failure_emitted[0]["payload"]["tasks"]["embedding"]["state"] == "waiting"
    assert failure_emitted[0]["payload"]["tasks"]["reranker"]["state"] == "waiting"
    assert phases(failure_emitted)[-1] == "failed"
    assert "running" not in phases(failure_emitted)


def make_model_service(
    status_store: ModelStatusStore,
    artifact_manager: FakeArtifactManager,
    *,
    embedding_loader,
    reranker_loader,
) -> ModelService:
    return ModelService(
        status_store=status_store,
        runtime_config=ModelRuntimeConfig(
            base_path=artifact_manager.cache_root.parent,
            embedding_model="Alibaba-NLP/gte-multilingual-base",
            reranker_model="Alibaba-NLP/gte-multilingual-reranker-base",
            ocr_model=DEFAULT_OCR_MODEL_DISPLAY,
            ocr_detection_model="PaddlePaddle/PP-OCRv4_mobile_det",
            ocr_recognition_model="PaddlePaddle/PP-OCRv4_mobile_rec",
            ocr_layout_model="PaddlePaddle/PP-DocLayout_plus-L",
            ocr_region_model="PaddlePaddle/PP-DocBlockLayout",
            ocr_doc_orientation_model="PaddlePaddle/PP-LCNet_x1_0_doc_ori",
            ocr_textline_orientation_model="PaddlePaddle/PP-LCNet_x1_0_textline_ori",
            ocr_enable_table_recognition=False,
            ocr_enable_formula_recognition=False,
            caption_model="vikhyatk/moondream2",
            preferred_device="cpu",
            model_cache_dir=artifact_manager.cache_root,
            huggingface_endpoint="https://hf.example",
        ),
        artifact_manager=artifact_manager,
        embedding_runtime_loader=embedding_loader,
        reranker_runtime_loader=reranker_loader,
        ocr_runtime_loader=lambda model_path, *, preferred_device: object(),
        caption_runtime_loader=lambda model_path, *, preferred_device: object(),
    )


def phases(events: list[dict]) -> list[str]:
    return [event["payload"]["phase"] for event in events]
