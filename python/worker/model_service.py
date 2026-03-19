from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from collections.abc import Callable
from typing import Any

from worker.model_artifact_manager import ModelArtifactManager
from worker.model_runtime_loader import load_local_embedding_runtime, load_local_reranker_runtime
from worker.status import ModelStatusStore


@dataclass(frozen=True)
class ModelRuntimeConfig:
    embedding_model: str
    reranker_model: str
    preferred_device: str
    model_cache_dir: Path
    huggingface_endpoint: str = ""


@dataclass(frozen=True)
class LoadedRerankerRuntime:
    tokenizer: Any
    model: Any


class ModelService:
    def __init__(
        self,
        status_store: ModelStatusStore,
        verify_embedding: Callable[[], None],
        verify_reranker: Callable[[], None],
        load_embedding_runtime: Callable[[], Any],
        load_reranker_runtime: Callable[[], Any],
        *,
        runtime_config: ModelRuntimeConfig | None = None,
        artifact_manager: ModelArtifactManager | None = None,
        embedding_runtime_loader: Callable[[Path, str], Any] | None = None,
        reranker_runtime_loader: Callable[[Path, str], Any] | None = None,
    ) -> None:
        self._status_store = status_store
        self._verify_embedding = verify_embedding
        self._verify_reranker = verify_reranker
        self._legacy_load_embedding_runtime = load_embedding_runtime
        self._legacy_load_reranker_runtime = load_reranker_runtime
        self._runtime_config = runtime_config
        self._artifact_manager = artifact_manager
        self._embedding_runtime_loader = embedding_runtime_loader or load_local_embedding_runtime
        self._reranker_runtime_loader = reranker_runtime_loader or load_local_reranker_runtime
        self._embedding_runtime: Any | None = None
        self._reranker_runtime: LoadedRerankerRuntime | None = None

    def snapshot(self) -> dict[str, Any]:
        return self._status_store.snapshot()

    def ensure_required_models(self) -> dict[str, bool]:
        if self._runtime_config is None or self._artifact_manager is None:
            return self._ensure_legacy_models()

        self._set_status(
            phase="verifying",
            progressPct=0,
            error="",
            embedding_state="verifying",
            reranker_state="verifying",
            embedding_progress=0,
            reranker_progress=0,
        )

        try:
            self._ensure_embedding_runtime()
            self._ensure_reranker_runtime()
        except Exception as error:
            self._mark_failed(str(error))
            return {"ok": False}

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

    def get_local_embedding_runtime(self) -> Any:
        if self._runtime_config is None or self._artifact_manager is None:
            return self._legacy_load_embedding_runtime()
        return self._ensure_embedding_runtime()

    def get_local_reranker_runtime(self) -> Any:
        if self._runtime_config is None or self._artifact_manager is None:
            return self._legacy_load_reranker_runtime()
        return self._ensure_reranker_runtime()

    def _ensure_legacy_models(self) -> dict[str, bool]:
        self._status_store.update(
            phase="verifying",
            progressPct=0,
            error="",
            tasks={
                "embedding": {
                    "id": "embedding-local",
                    "model": "embedding",
                    "state": "verifying",
                    "progressPct": 0,
                    "error": "",
                },
                "reranker": {
                    "id": "reranker-local",
                    "model": "reranker",
                    "state": "verifying",
                    "progressPct": 0,
                    "error": "",
                },
            },
        )

        try:
            self._verify_embedding()
            self._verify_reranker()
        except Exception as error:
            self._status_store.update(
                phase="failed",
                error=str(error),
                tasks={
                    **self.snapshot()["tasks"],
                    "embedding": {
                        **(self.snapshot()["tasks"]["embedding"] or {}),
                        "state": "failed",
                        "error": str(error),
                    },
                },
            )
            return {"ok": False}

        self._status_store.update(
            phase="completed",
            progressPct=100,
            error="",
            tasks={
                "embedding": {
                    "id": "embedding-local",
                    "model": "embedding",
                    "state": "ready",
                    "progressPct": 100,
                    "error": "",
                },
                "reranker": {
                    "id": "reranker-local",
                    "model": "reranker",
                    "state": "ready",
                    "progressPct": 100,
                    "error": "",
                },
            },
        )
        return {"ok": True}

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

    def _ensure_embedding_runtime(self) -> Any:
        if self._embedding_runtime is not None:
            return self._embedding_runtime

        assert self._runtime_config is not None
        assert self._artifact_manager is not None
        self._update_task_state(
            "embedding",
            "downloading",
            0,
            self._runtime_config.embedding_model,
        )
        artifact = self._artifact_manager.ensure_artifacts(
            kind="embedding",
            model=self._runtime_config.embedding_model,
            force_redownload=False,
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

    def _ensure_reranker_runtime(self) -> LoadedRerankerRuntime:
        if self._reranker_runtime is not None:
            return self._reranker_runtime

        assert self._runtime_config is not None
        assert self._artifact_manager is not None
        self._update_task_state(
            "reranker",
            "downloading",
            0,
            self._runtime_config.reranker_model,
        )
        artifact = self._artifact_manager.ensure_artifacts(
            kind="reranker",
            model=self._runtime_config.reranker_model,
            force_redownload=False,
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

    def _coerce_reranker_runtime(self, runtime: Any) -> LoadedRerankerRuntime:
        if isinstance(runtime, LoadedRerankerRuntime):
            return runtime
        if isinstance(runtime, tuple) and len(runtime) == 2:
            return LoadedRerankerRuntime(tokenizer=runtime[0], model=runtime[1])
        raise TypeError("reranker runtime must provide tokenizer and model")

    def _mark_failed(self, error: str) -> None:
        tasks = self.snapshot()["tasks"]
        self._status_store.update(
            phase="failed",
            error=error,
            tasks={
                "embedding": {
                    **(tasks["embedding"] or {}),
                    "state": "failed",
                    "error": error,
                },
                "reranker": {
                    **(tasks["reranker"] or {}),
                    "state": "failed",
                    "error": error,
                },
            },
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

    def _aggregate_progress(self, tasks: dict[str, Any]) -> int:
        values = []
        for kind in ("embedding", "reranker"):
            task = tasks.get(kind)
            if isinstance(task, dict):
                values.append(int(task.get("progressPct", 0)))
        if not values:
            return 0
        return round(sum(values) / len(values))
