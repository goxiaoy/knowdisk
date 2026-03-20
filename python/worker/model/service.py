from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Protocol

from worker.model.artifact_manager import ModelArtifactManager
from worker.model.artifacts import has_complete_local_model_artifacts, has_resumable_partial_downloads
from worker.model.types import LoadedRerankerRuntime, ModelRuntimeConfig
from worker.model.runtime_loader import load_local_embedding_runtime, load_local_reranker_runtime
from worker.runtime.logging import WorkerLogger
from worker.runtime.status import ModelStatusStore


class EmbeddingRuntimeLoader(Protocol):
    def __call__(self, model_path: Path, *, preferred_device: str) -> object: ...


class RerankerRuntimeLoader(Protocol):
    def __call__(self, model_path: Path, *, preferred_device: str) -> object: ...


class ModelService:
    def __init__(
        self,
        status_store: ModelStatusStore,
        *,
        runtime_config: ModelRuntimeConfig | None = None,
        artifact_manager: ModelArtifactManager | None = None,
        embedding_runtime_loader: EmbeddingRuntimeLoader | None = None,
        reranker_runtime_loader: RerankerRuntimeLoader | None = None,
        logger: WorkerLogger | None = None,
    ) -> None:
        self._status_store = status_store
        self._runtime_config = runtime_config
        self._artifact_manager = artifact_manager
        self._embedding_runtime_loader = embedding_runtime_loader or load_local_embedding_runtime
        self._reranker_runtime_loader = reranker_runtime_loader or load_local_reranker_runtime
        self._logger = logger
        self._embedding_runtime: object | None = None
        self._reranker_runtime: object | None = None
        self._last_logged_progress_pct: dict[str, int] = {}
        self._ensure_lock = threading.Lock()
        self._task_condition = threading.Condition()
        self._task_inflight: dict[str, bool] = {
            "embedding": False,
            "reranker": False,
        }
        self._task_errors: dict[str, str] = {
            "embedding": "",
            "reranker": "",
        }

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
        with self._task_condition:
            self._task_errors = {"embedding": "", "reranker": ""}
            self._task_inflight = {"embedding": False, "reranker": False}

    def snapshot(self) -> dict[str, Any]:
        return self._status_store.snapshot()

    def ensure_required_models(self) -> dict[str, bool]:
        if self._runtime_config is None or self._artifact_manager is None:
            self._status_store.update(
                phase="failed",
                progressPct=0,
                error="model runtime is not configured",
                tasks={
                    "embedding": self._task_status("embedding-local", "embedding", "failed", 0, ""),
                    "reranker": self._task_status("reranker-local", "reranker", "failed", 0, ""),
                },
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
            )

            try:
                self._begin_task_wait("embedding")
                self._set_task_state("embedding", "verifying", 0)
                self._ensure_embedding_runtime()
            except Exception as error:
                self._finish_task_wait("embedding", error=str(error))
                self._mark_task_failed("embedding", str(error))
                return {"ok": False}
            else:
                self._finish_task_wait("embedding", error="")

            try:
                self._begin_task_wait("reranker")
                self._set_task_state("reranker", "verifying", 0)
                self._ensure_reranker_runtime()
            except Exception as error:
                self._finish_task_wait("reranker", error=str(error))
                self._mark_task_failed("reranker", str(error))
                return {"ok": False}
            else:
                self._finish_task_wait("reranker", error="")

            self._set_status(
                phase="completed",
                progressPct=100,
                error="",
                embedding_state="ready",
                reranker_state="ready",
                embedding_progress=100,
                reranker_progress=100,
            )
            return {"ok": True}

    def get_local_embedding_runtime(self) -> object:
        return self._wait_for_runtime("embedding")

    def get_local_reranker_runtime(self) -> object:
        return self._wait_for_runtime("reranker")

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
    ) -> None:
        embedding_model = (
            self._runtime_config.embedding_model if self._runtime_config is not None else "embedding"
        )
        reranker_model = (
            self._runtime_config.reranker_model if self._runtime_config is not None else "reranker"
        )
        self._status_store.update(
            phase=phase,
            progressPct=progressPct,
            error=error,
            tasks={
                "embedding": self._task_status(
                    "embedding-local",
                    embedding_model,
                    embedding_state,
                    embedding_progress,
                    "",
                ),
                "reranker": self._task_status(
                    "reranker-local",
                    reranker_model,
                    reranker_state,
                    reranker_progress,
                    "",
                ),
            },
        )

    def _ensure_embedding_runtime(self) -> object:
        if self._embedding_runtime is not None:
            return self._embedding_runtime

        assert self._runtime_config is not None
        assert self._artifact_manager is not None
        model_root = self._artifact_manager.resolve_model_root(
            "embedding", self._runtime_config.embedding_model
        )
        if has_complete_local_model_artifacts("embedding", model_root):
            try:
                self._embedding_runtime = self._embedding_runtime_loader(
                    model_root,
                    preferred_device=self._runtime_config.preferred_device,
                )
                self._update_task_state("embedding", "ready", 100, self._runtime_config.embedding_model)
                return self._embedding_runtime
            except Exception as error:
                self._log_cached_runtime_load_failure(
                    kind="embedding",
                    model=self._runtime_config.embedding_model,
                    model_root=model_root,
                    error=error,
                )

        self._update_task_state(
            "embedding",
            "downloading",
            0,
            self._runtime_config.embedding_model,
        )
        force_redownload = model_root.exists() and not has_resumable_partial_downloads(model_root)
        artifact = self._artifact_manager.ensure_artifacts(
            kind="embedding",
            model=self._runtime_config.embedding_model,
            force_redownload=force_redownload,
            on_progress=lambda downloaded, total: self._update_progress(
                "embedding",
                downloaded,
                total,
                model=self._runtime_config.embedding_model,
            ),
        )
        self._embedding_runtime = self._embedding_runtime_loader(
            artifact.model_root,
            preferred_device=self._runtime_config.preferred_device,
        )
        self._update_task_state("embedding", "ready", 100, self._runtime_config.embedding_model)
        return self._embedding_runtime

    def _ensure_reranker_runtime(self) -> object:
        if self._reranker_runtime is not None:
            return self._reranker_runtime

        assert self._runtime_config is not None
        assert self._artifact_manager is not None
        model_root = self._artifact_manager.resolve_model_root(
            "reranker", self._runtime_config.reranker_model
        )
        if has_complete_local_model_artifacts("reranker", model_root):
            try:
                loaded = self._reranker_runtime_loader(
                    model_root,
                    preferred_device=self._runtime_config.preferred_device,
                )
                self._reranker_runtime = self._coerce_reranker_runtime(loaded)
                self._update_task_state("reranker", "ready", 100, self._runtime_config.reranker_model)
                return self._reranker_runtime
            except Exception as error:
                self._log_cached_runtime_load_failure(
                    kind="reranker",
                    model=self._runtime_config.reranker_model,
                    model_root=model_root,
                    error=error,
                )

        self._update_task_state(
            "reranker",
            "downloading",
            0,
            self._runtime_config.reranker_model,
        )
        force_redownload = model_root.exists() and not has_resumable_partial_downloads(model_root)
        artifact = self._artifact_manager.ensure_artifacts(
            kind="reranker",
            model=self._runtime_config.reranker_model,
            force_redownload=force_redownload,
            on_progress=lambda downloaded, total: self._update_progress(
                "reranker",
                downloaded,
                total,
                model=self._runtime_config.reranker_model,
            ),
        )
        loaded = self._reranker_runtime_loader(
            artifact.model_root,
            preferred_device=self._runtime_config.preferred_device,
        )
        self._reranker_runtime = self._coerce_reranker_runtime(loaded)
        self._update_task_state("reranker", "ready", 100, self._runtime_config.reranker_model)
        return self._reranker_runtime

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
            model = (
                self._runtime_config.embedding_model
                if kind == "embedding" and self._runtime_config is not None
                else self._runtime_config.reranker_model
                if kind == "reranker" and self._runtime_config is not None
                else kind
            )
            failed_task = self._task_status(f"{kind}-local", model, "failed", 0, error)
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
        model = (
            self._runtime_config.embedding_model
            if kind == "embedding" and self._runtime_config is not None
            else self._runtime_config.reranker_model
            if kind == "reranker" and self._runtime_config is not None
            else kind
        )
        tasks[kind] = self._task_status(f"{kind}-local", model, state, progress_pct, "")
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
        for kind in ("embedding", "reranker"):
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
        raise ValueError(f"unknown model task kind: {kind}")
