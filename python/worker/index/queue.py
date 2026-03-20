from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
from pathlib import Path
from tempfile import gettempdir

from worker.runtime.status import IndexStatusStore
from worker.runtime.types import IndexStatusSnapshot
from worker.index.queue_store import SQLiteIndexQueueStore


Job = Callable[[], None]


class IndexQueue:
    def __init__(
        self,
        status_store: IndexStatusStore,
        queue_store: SQLiteIndexQueueStore | None = None,
    ) -> None:
        self._status_store = status_store
        self._queue_store = (
            queue_store
            if queue_store is not None
            else SQLiteIndexQueueStore(_default_queue_db_path())
        )

    def snapshot(self) -> IndexStatusSnapshot:
        return self._queue_store.snapshot()

    def enqueue_incremental(self, node_name: str, job: Job) -> None:
        snapshot = self._queue_store.reserve_incremental(node_name)
        self._status_store.update(
            phase="indexing",
            scope="incremental",
            queueDepth=int(snapshot["queueDepth"]),
            totalFiles=1,
            processedFiles=0,
            activeNodeName=node_name,
            error="",
        )

        try:
            job()
        finally:
            snapshot = self._queue_store.complete_incremental()
            self._emit_status_snapshot(snapshot)

    def _emit_status_snapshot(self, snapshot: IndexStatusSnapshot) -> None:
        self._status_store._snapshot = deepcopy(snapshot)  # type: ignore[attr-defined]
        self._status_store._event_sink(  # type: ignore[attr-defined]
            {"type": "index_status_changed", "payload": deepcopy(snapshot)}
        )


def _default_queue_db_path() -> Path:
    return Path(gettempdir()) / "knowdisk-python-worker" / "index-queue.sqlite3"
