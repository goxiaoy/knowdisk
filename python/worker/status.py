from __future__ import annotations

from collections.abc import Callable
from typing import Any


EventSink = Callable[[dict[str, Any]], None]


class ModelStatusStore:
    def __init__(self, event_sink: EventSink) -> None:
        self._event_sink = event_sink
        self._snapshot: dict[str, Any] = {
            "phase": "idle",
            "progressPct": 0,
            "error": "",
            "available": False,
            "tasks": {
                "embedding": None,
                "reranker": None,
            },
        }

    def snapshot(self) -> dict[str, Any]:
        return dict(self._snapshot)

    def update(self, **changes: Any) -> dict[str, Any]:
        next_snapshot = {**self._snapshot, **changes}
        next_snapshot["available"] = True
        self._snapshot = next_snapshot
        self._event_sink({"type": "model_status_changed", "payload": self.snapshot()})
        return self.snapshot()


class IndexStatusStore:
    def __init__(self, event_sink: EventSink) -> None:
        self._event_sink = event_sink
        self._snapshot: dict[str, Any] = {
            "available": False,
            "phase": "idle",
            "scope": None,
            "queueDepth": 0,
            "processedFiles": 0,
            "totalFiles": 0,
            "activeNodeName": "",
            "error": "",
        }

    def snapshot(self) -> dict[str, Any]:
        return dict(self._snapshot)

    def update(self, **changes: Any) -> dict[str, Any]:
        next_snapshot = {**self._snapshot, **changes}
        next_snapshot["available"] = True
        self._snapshot = next_snapshot
        self._event_sink({"type": "index_status_changed", "payload": self.snapshot()})
        return self.snapshot()


class VectorStatusStore:
    def __init__(self, event_sink: EventSink) -> None:
        self._event_sink = event_sink
        self._snapshot: dict[str, Any] = {
            "available": False,
            "chunkCount": None,
            "lastUpdatedAt": "",
            "error": "",
        }

    def snapshot(self) -> dict[str, Any]:
        return dict(self._snapshot)

    def update(self, **changes: Any) -> dict[str, Any]:
        next_snapshot = {**self._snapshot, **changes}
        next_snapshot["available"] = True
        self._snapshot = next_snapshot
        self._event_sink({"type": "vector_status_changed", "payload": self.snapshot()})
        return self.snapshot()
