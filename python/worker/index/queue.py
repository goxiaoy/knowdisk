from __future__ import annotations

from collections.abc import Callable
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
        snapshot = self.snapshot()
        queue_depth = int(snapshot["queueDepth"]) + 1
        self._queue_store.update(
            phase="indexing",
            scope="incremental",
            queueDepth=queue_depth,
            totalFiles=1,
            processedFiles=0,
            activeNodeName=node_name,
            error="",
        )
        self._status_store.update(
            phase="indexing",
            scope="incremental",
            queueDepth=queue_depth,
            totalFiles=1,
            processedFiles=0,
            activeNodeName=node_name,
            error="",
        )

        try:
            job()
        finally:
            self._queue_store.update(
                phase="idle",
                scope=None,
                queueDepth=max(0, queue_depth - 1),
                processedFiles=1,
                totalFiles=1,
                activeNodeName="",
                error="",
            )
            self._status_store.update(
                phase="idle",
                scope=None,
                queueDepth=max(0, queue_depth - 1),
                processedFiles=1,
                totalFiles=1,
                activeNodeName="",
                error="",
            )


def _default_queue_db_path() -> Path:
    return Path(gettempdir()) / "knowdisk-python-worker" / "index-queue.sqlite3"
