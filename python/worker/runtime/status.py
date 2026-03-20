from __future__ import annotations

from copy import deepcopy
from collections.abc import Callable
from typing import cast

from worker.runtime.types import (
    IndexStatusSnapshot,
    ModelStatusSnapshot,
    ModelTasksSnapshot,
    WorkerStatusEvent,
    create_default_index_status_snapshot,
    create_default_model_status_snapshot,
    create_default_vector_status_snapshot,
    VectorStatusSnapshot,
)

EventSink = Callable[[WorkerStatusEvent], None]
_MISSING = object()


class ModelStatusStore:
    def __init__(self, event_sink: EventSink) -> None:
        self._event_sink = event_sink
        self._snapshot: ModelStatusSnapshot = create_default_model_status_snapshot()

    def snapshot(self) -> ModelStatusSnapshot:
        return deepcopy(self._snapshot)

    def update(
        self,
        *,
        phase: str | None = None,
        progressPct: int | None = None,
        error: str | None = None,
        available: bool | None = None,
        tasks: ModelTasksSnapshot | None = None,
    ) -> ModelStatusSnapshot:
        next_snapshot = deepcopy(self._snapshot)
        if phase is not None:
            next_snapshot["phase"] = phase
        if progressPct is not None:
            next_snapshot["progressPct"] = progressPct
        if error is not None:
            next_snapshot["error"] = error
        if tasks is not None:
            next_snapshot["tasks"] = tasks
        next_snapshot["available"] = True if available is None else available
        self._snapshot = cast(ModelStatusSnapshot, next_snapshot)
        self._event_sink({"type": "model_status_changed", "payload": self.snapshot()})
        return self.snapshot()


class IndexStatusStore:
    def __init__(self, event_sink: EventSink) -> None:
        self._event_sink = event_sink
        self._snapshot: IndexStatusSnapshot = create_default_index_status_snapshot()

    def snapshot(self) -> IndexStatusSnapshot:
        return deepcopy(self._snapshot)

    def update(
        self,
        *,
        phase: str | None = None,
        scope: str | None | object = _MISSING,
        queueDepth: int | None = None,
        processedFiles: int | None = None,
        totalFiles: int | None = None,
        activeNodeName: str | None = None,
        error: str | None = None,
        available: bool | None = None,
    ) -> IndexStatusSnapshot:
        next_snapshot = deepcopy(self._snapshot)
        if phase is not None:
            next_snapshot["phase"] = phase
        if scope is not _MISSING:
            next_snapshot["scope"] = scope
        if queueDepth is not None:
            next_snapshot["queueDepth"] = queueDepth
        if processedFiles is not None:
            next_snapshot["processedFiles"] = processedFiles
        if totalFiles is not None:
            next_snapshot["totalFiles"] = totalFiles
        if activeNodeName is not None:
            next_snapshot["activeNodeName"] = activeNodeName
        if error is not None:
            next_snapshot["error"] = error
        next_snapshot["available"] = True if available is None else available
        self._snapshot = cast(IndexStatusSnapshot, next_snapshot)
        self._event_sink({"type": "index_status_changed", "payload": self.snapshot()})
        return self.snapshot()


class VectorStatusStore:
    def __init__(self, event_sink: EventSink) -> None:
        self._event_sink = event_sink
        self._snapshot: VectorStatusSnapshot = create_default_vector_status_snapshot()

    def snapshot(self) -> VectorStatusSnapshot:
        return deepcopy(self._snapshot)

    def update(
        self,
        *,
        available: bool | None = None,
        chunkCount: int | None = None,
        lastUpdatedAt: str | None = None,
        error: str | None = None,
    ) -> VectorStatusSnapshot:
        next_snapshot = deepcopy(self._snapshot)
        if chunkCount is not None:
            next_snapshot["chunkCount"] = chunkCount
        if lastUpdatedAt is not None:
            next_snapshot["lastUpdatedAt"] = lastUpdatedAt
        if error is not None:
            next_snapshot["error"] = error
        next_snapshot["available"] = True if available is None else available
        self._snapshot = cast(VectorStatusSnapshot, next_snapshot)
        self._event_sink({"type": "vector_status_changed", "payload": self.snapshot()})
        return self.snapshot()
