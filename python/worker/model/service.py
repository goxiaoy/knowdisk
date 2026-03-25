from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from worker.model.artifact_manager import ModelArtifactManager
from worker.model.artifacts import has_complete_local_model_artifacts, has_resumable_partial_downloads
from worker.model.image_runtime import load_local_caption_runtime, load_local_ocr_runtime
from worker.model.runtime_loader import load_local_embedding_runtime, load_local_reranker_runtime
from worker.model.types import LoadedRerankerRuntime, ModelRuntimeConfig
from worker.runtime.logging import WorkerLogger
from worker.runtime.status import ModelStatusStore


class EmbeddingRuntimeLoader(Protocol):
    def __call__(self, model_path: Path, *, preferred_device: str) -> object: ...


class RerankerRuntimeLoader(Protocol):
    def __call__(self, model_path: Path, *, preferred_device: str) -> object: ...


class OcrRuntimeLoader(Protocol):
    def __call__(self, model_path: Path, *, preferred_device: str) -> object: ...


class CaptionRuntimeLoader(Protocol):
    def __call__(self, model_path: Path, *, preferred_device: str) -> object: ...


_TASK_KINDS: tuple[str, ...] = ("embedding", "reranker", "ocr", "caption")


class ModelService:
    def __init__(
        self,
        status_store: ModelStatusStore,
        *,
        runtime_config: ModelRuntimeConfig | None = None,
        artifact_manager: ModelArtifactManager | None = None,
        embedding_runtime_loader: EmbeddingRuntimeLoader | None = None,
        reranker_runtime_loader: RerankerRuntimeLoader | None = None,
        ocr_runtime_loader: OcrRuntimeLoader | None = None,
        caption_runtime_loader: CaptionRuntimeLoader | None = None,
        logger: WorkerLogger | None = None,
    ) -> None:
        self._status_store = status_store
        self._runtime_config = runtime_config
        self._artifact_manager = artifact_manager
        self._embedding_runtime_loader = embedding_runtime_loader or load_local_embedding_runtime
        self._reranker_runtime_loader = reranker_runtime_loader or load_local_reranker_runtime
        self._ocr_runtime_loader = ocr_runtime_loader or _load_local_ocr_runtime
        self._caption_runtime_loader = caption_runtime_loader or _load_local_caption_runtime
        self._logger = logger
        self._embedding_runtime: object | None = None
        self._reranker_runtime: object | None = None
        self._ocr_runtime: object | None = None
        self._caption_runtime: object | None = None
        self._last_logged_progress_pct: dict[str, int] = {}
        self._ensure_lock = threading.Lock()
        self._task_condition = threading.Condition()
        self._task_inflight: dict[str, bool] = {kind: False for kind in _TASK_KINDS}
        self._task_errors: dict[str, str] = {kind: "" for kind in _TASK_KINDS}
        self._preparation_thread: threading.Thread | None = None

    def configure_runtime(
        self,
        config: ModelRuntimeConfig,
        *,
        artifact_manager: ModelArtifactManager,
    ) -> None:
        self._runtime_config = config
        self._artifact_manager = artifact_manager
        self._embedding_runtime = None
        self._reranker_runtime = None
        self._ocr_runtime = None
        self._caption_runtime = None
        with self._task_condition:
            self._task_errors = {kind: "" for kind in _TASK_KINDS}
            self._task_inflight = {kind: False for kind in _TASK_KINDS}

    def snapshot(self) -> dict[str, Any]:
        return self._status_store.snapshot()

    def start_required_models(self) -> None:
        with self._task_condition:
            thread = self._preparation_thread
            if thread is not None and thread.is_alive():
                return
            self._preparation_thread = threading.Thread(
                target=self.ensure_required_models,
                name="knowdisk-model-prepare",
                daemon=True,
            )
            self._preparation_thread.start()

    def ensure_required_models(self) -> dict[str, bool]:
        if self._runtime_config is None or self._artifact_manager is None:
            self._status_store.update(
                phase="failed",
                progressPct=0,
                error="model runtime is not configured",
                tasks=self._create_task_snapshot("failed", 0, ""),
            )
            return {"ok": False}

        with self._ensure_lock:
            self._set_status(
                phase="verifying",
                progressPct=0,
                error="",
                embedding_state="waiting",
                reranker_state="waiting",
                embedding_progress=0,
                reranker_progress=0,
                ocr_state="waiting",
                caption_state="waiting",
                ocr_progress=0,
                caption_progress=0,
            )

            for kind in _TASK_KINDS:
                try:
                    self._begin_task_wait(kind)
                    self._set_task_state(kind, "verifying", 0)
                    self._ensure_runtime_for_kind(kind)
                except Exception as error:
                    self._finish_task_wait(kind, error=str(error))
                    self._mark_task_failed(kind, str(error))
                    return {"ok": False}
                else:
                    self._finish_task_wait(kind, error="")

            self._set_status(
                phase="completed",
                progressPct=100,
                error="",
                embedding_state="ready",
                reranker_state="ready",
                embedding_progress=100,
                reranker_progress=100,
                ocr_state="ready",
                caption_state="ready",
                ocr_progress=100,
                caption_progress=100,
            )
            return {"ok": True}

    def get_local_embedding_runtime(self) -> object:
        return self._wait_for_runtime("embedding")

    def get_local_reranker_runtime(self) -> object:
        return self._wait_for_runtime("reranker")

    def get_local_ocr_runtime(self) -> object:
        with self._ensure_lock:
            return self._ensure_runtime_for_kind("ocr")

    def get_local_caption_runtime(self) -> object:
        with self._ensure_lock:
            return self._ensure_runtime_for_kind("caption")

    def _set_status(
        self,
        *,
        phase: str,
        progressPct: int,
        error: str,
        embedding_state: str,
        reranker_state: str,
        embedding_progress: int,
        reranker_progress: int,
        ocr_state: str,
        caption_state: str,
        ocr_progress: int,
        caption_progress: int,
    ) -> None:
        self._status_store.update(
            phase=phase,
            progressPct=progressPct,
            error=error,
            tasks={
                "embedding": self._task_status(
                    "embedding-local",
                    self._model_name_for_kind("embedding"),
                    embedding_state,
                    embedding_progress,
                    "",
                ),
                "reranker": self._task_status(
                    "reranker-local",
                    self._model_name_for_kind("reranker"),
                    reranker_state,
                    reranker_progress,
                    "",
                ),
                "ocr": self._task_status(
                    "ocr-local",
                    self._model_name_for_kind("ocr"),
                    ocr_state,
                    ocr_progress,
                    "",
                ),
                "caption": self._task_status(
                    "caption-local",
                    self._model_name_for_kind("caption"),
                    caption_state,
                    caption_progress,
                    "",
                ),
            },
        )

    def _ensure_embedding_runtime(self) -> object:
        return self._ensure_runtime_for_kind("embedding")

    def _ensure_reranker_runtime(self) -> object:
        return self._ensure_runtime_for_kind("reranker")

    def _ensure_ocr_runtime(self) -> object:
        return self._ensure_runtime_for_kind("ocr")

    def _ensure_caption_runtime(self) -> object:
        return self._ensure_runtime_for_kind("caption")

    def _coerce_reranker_runtime(self, runtime: Any) -> object:
        if isinstance(runtime, LoadedRerankerRuntime):
            return runtime
        if isinstance(runtime, tuple) and len(runtime) == 2:
            return LoadedRerankerRuntime(tokenizer=runtime[0], model=runtime[1])
        return runtime

    def _mark_task_failed(self, kind: str, error: str) -> None:
        tasks = self.snapshot()["tasks"]
        current_task = tasks.get(kind)
        if isinstance(current_task, dict):
            failed_task = {**current_task, "state": "failed", "error": error}
        else:
            failed_task = self._task_status(f"{kind}-local", self._model_name_for_kind(kind), "failed", 0, error)
        tasks[kind] = failed_task
        self._status_store.update(
            phase="failed",
            error=error,
            tasks=tasks,
        )
        if self._logger is not None:
            self._logger.log(
                "error",
                "model task failed",
                kind=kind,
                model=self._model_name_for_kind(kind),
                error=error,
                progressPct=failed_task.get("progressPct", 0) if isinstance(failed_task, dict) else 0,
            )

    def _task_status(
        self,
        task_id: str,
        model: str,
        state: str,
        progress_pct: int,
        error: str,
    ) -> dict[str, Any]:
        return {
            "id": task_id,
            "model": model,
            "state": state,
            "progressPct": progress_pct,
            "error": error,
        }

    def _update_task_state(self, kind: str, state: str, progress_pct: int, model: str) -> None:
        tasks = self.snapshot()["tasks"]
        tasks[kind] = self._task_status(f"{kind}-local", model, state, progress_pct, "")
        self._status_store.update(
            phase="running" if state == "downloading" else "verifying",
            progressPct=self._aggregate_progress(tasks),
            error="",
            tasks=tasks,
        )

    def _set_task_state(self, kind: str, state: str, progress_pct: int) -> None:
        tasks = self.snapshot()["tasks"]
        tasks[kind] = self._task_status(
            f"{kind}-local",
            self._model_name_for_kind(kind),
            state,
            progress_pct,
            "",
        )
        self._status_store.update(
            phase="verifying",
            progressPct=self._aggregate_progress(tasks),
            error="",
            tasks=tasks,
        )

    def _update_progress(self, kind: str, downloaded: int, total: int, *, model: str) -> None:
        progress_pct = 0 if total <= 0 else min(100, round((downloaded / total) * 100))
        tasks = self.snapshot()["tasks"]
        tasks[kind] = self._task_status(f"{kind}-local", model, "downloading", progress_pct, "")
        self._status_store.update(
            phase="running",
            progressPct=self._aggregate_progress(tasks),
            error="",
            tasks=tasks,
        )
        last_logged = self._last_logged_progress_pct.get(kind)
        if self._logger is not None and last_logged != progress_pct:
            self._last_logged_progress_pct[kind] = progress_pct
            self._logger.log(
                "debug",
                "model download progress",
                kind=kind,
                model=model,
                downloaded=downloaded,
                total=total,
                progressPct=progress_pct,
            )

    def _wait_for_runtime(self, kind: str) -> object:
        with self._task_condition:
            while True:
                runtime = self._runtime_for_kind(kind)
                if runtime is not None:
                    return runtime
                if self._task_inflight[kind]:
                    self._task_condition.wait()
                    continue
                error = self._task_errors[kind]
                if error:
                    raise RuntimeError(error)
                raise RuntimeError(f"{kind} runtime is not ready")

    def _aggregate_progress(self, tasks: dict[str, Any]) -> int:
        values = []
        for kind in _TASK_KINDS:
            task = tasks.get(kind)
            if isinstance(task, dict):
                values.append(int(task.get("progressPct", 0)))
        if not values:
            return 0
        return round(sum(values) / len(values))

    def _log_cached_runtime_load_failure(
        self,
        *,
        kind: str,
        model: str,
        model_root: Path,
        error: Exception,
    ) -> None:
        if self._logger is None:
            return
        self._logger.log(
            "warn",
            "failed to load cached model runtime, falling back to download",
            kind=kind,
            model=model,
            modelRoot=str(model_root),
            error=str(error),
        )

    def _begin_task_wait(self, kind: str) -> None:
        with self._task_condition:
            self._task_inflight[kind] = True
            self._task_errors[kind] = ""
            self._task_condition.notify_all()

    def _finish_task_wait(self, kind: str, *, error: str) -> None:
        with self._task_condition:
            self._task_inflight[kind] = False
            self._task_errors[kind] = error
            self._task_condition.notify_all()

    def _runtime_for_kind(self, kind: str) -> object | None:
        if kind == "embedding":
            return self._embedding_runtime
        if kind == "reranker":
            return self._reranker_runtime
        if kind == "ocr":
            return self._ocr_runtime
        if kind == "caption":
            return self._caption_runtime
        raise ValueError(f"unknown model task kind: {kind}")

    def _set_runtime_for_kind(self, kind: str, runtime: object) -> None:
        if kind == "embedding":
            self._embedding_runtime = runtime
            return
        if kind == "reranker":
            self._reranker_runtime = runtime
            return
        if kind == "ocr":
            self._ocr_runtime = runtime
            return
        if kind == "caption":
            self._caption_runtime = runtime
            return
        raise ValueError(f"unknown model task kind: {kind}")

    def _model_name_for_kind(self, kind: str) -> str:
        if self._runtime_config is None:
            return kind
        if kind == "embedding":
            return self._runtime_config.embedding_model
        if kind == "reranker":
            return self._runtime_config.reranker_model
        if kind == "ocr":
            return self._runtime_config.ocr_model
        if kind == "caption":
            return self._runtime_config.caption_model
        raise ValueError(f"unknown model task kind: {kind}")

    def _loader_for_kind(self, kind: str):
        if kind == "embedding":
            return self._embedding_runtime_loader
        if kind == "reranker":
            return self._reranker_runtime_loader
        if kind == "ocr":
            return self._ocr_runtime_loader
        if kind == "caption":
            return self._caption_runtime_loader
        raise ValueError(f"unknown model task kind: {kind}")

    def _create_task_snapshot(self, state: str, progress_pct: int, error: str) -> dict[str, Any]:
        return {
            "embedding": self._task_status(
                "embedding-local",
                self._model_name_for_kind("embedding"),
                state,
                progress_pct,
                error,
            ),
            "reranker": self._task_status(
                "reranker-local",
                self._model_name_for_kind("reranker"),
                state,
                progress_pct,
                error,
            ),
            "ocr": self._task_status(
                "ocr-local",
                self._model_name_for_kind("ocr"),
                state,
                progress_pct,
                error,
            ),
            "caption": self._task_status(
                "caption-local",
                self._model_name_for_kind("caption"),
                state,
                progress_pct,
                error,
            ),
        }

    def _ensure_runtime_for_kind(self, kind: str) -> object:
        runtime = self._runtime_for_kind(kind)
        if runtime is not None:
            return runtime

        assert self._runtime_config is not None
        assert self._artifact_manager is not None
        model_name = self._model_name_for_kind(kind)
        model_root = self._artifact_manager.resolve_model_root(kind, model_name)
        loader = self._loader_for_kind(kind)

        if has_complete_local_model_artifacts(kind, model_root):
            try:
                loaded = loader(
                    model_root,
                    preferred_device=self._runtime_config.preferred_device,
                )
                runtime = self._coerce_runtime(kind, loaded)
                self._set_runtime_for_kind(kind, runtime)
                self._update_task_state(kind, "ready", 100, model_name)
                return runtime
            except Exception as error:
                self._log_cached_runtime_load_failure(
                    kind=kind,
                    model=model_name,
                    model_root=model_root,
                    error=error,
                )
                self._update_task_state(kind, "downloading", 0, model_name)
                artifact = self._artifact_manager.ensure_artifacts(
                    kind=kind,
                    model=model_name,
                    force_redownload=True,
                    on_progress=lambda downloaded, total: self._update_progress(
                        kind,
                        downloaded,
                        total,
                        model=model_name,
                    ),
                )
                loaded = loader(
                    artifact.model_root,
                    preferred_device=self._runtime_config.preferred_device,
                )
                runtime = self._coerce_runtime(kind, loaded)
                self._set_runtime_for_kind(kind, runtime)
                self._update_task_state(kind, "ready", 100, model_name)
                return runtime

        self._update_task_state(kind, "downloading", 0, model_name)
        artifact = self._artifact_manager.ensure_artifacts(
            kind=kind,
            model=model_name,
            force_redownload=False,
            on_progress=lambda downloaded, total: self._update_progress(
                kind,
                downloaded,
                total,
                model=model_name,
            ),
        )
        loaded = loader(
            artifact.model_root,
            preferred_device=self._runtime_config.preferred_device,
        )
        runtime = self._coerce_runtime(kind, loaded)
        self._set_runtime_for_kind(kind, runtime)
        self._update_task_state(kind, "ready", 100, model_name)
        return runtime

    def _coerce_runtime(self, kind: str, runtime: Any) -> object:
        if kind == "reranker":
            return self._coerce_reranker_runtime(runtime)
        return runtime


def _load_local_ocr_runtime(model_path: Path, *, preferred_device: str) -> object:
    return load_local_ocr_runtime(Path(model_path), preferred_device=preferred_device)


def _load_local_caption_runtime(model_path: Path, *, preferred_device: str) -> object:
    return load_local_caption_runtime(Path(model_path), preferred_device=preferred_device)
