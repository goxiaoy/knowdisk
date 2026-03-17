from __future__ import annotations

from collections.abc import Callable
from typing import Any

from worker.status import ModelStatusStore


class ModelService:
    def __init__(
        self,
        status_store: ModelStatusStore,
        verify_embedding: Callable[[], None],
        verify_reranker: Callable[[], None],
        load_embedding_runtime: Callable[[], Any],
        load_reranker_runtime: Callable[[], Any],
    ) -> None:
        self._status_store = status_store
        self._verify_embedding = verify_embedding
        self._verify_reranker = verify_reranker
        self._load_embedding_runtime = load_embedding_runtime
        self._load_reranker_runtime = load_reranker_runtime

    def snapshot(self) -> dict[str, Any]:
        return self._status_store.snapshot()

    def ensure_required_models(self) -> dict[str, bool]:
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

    def get_local_embedding_runtime(self) -> Any:
        return self._load_embedding_runtime()

    def get_local_reranker_runtime(self) -> Any:
        return self._load_reranker_runtime()
