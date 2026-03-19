from __future__ import annotations

from collections.abc import Callable

from worker.runtime.types import IndexStatusSnapshot
from worker.status import IndexStatusStore


Job = Callable[[], None]


class IndexQueue:
    def __init__(self, status_store: IndexStatusStore) -> None:
        self._status_store = status_store

    def snapshot(self) -> IndexStatusSnapshot:
        return self._status_store.snapshot()

    def enqueue_incremental(self, node_name: str, job: Job) -> None:
        snapshot = self.snapshot()
        queue_depth = int(snapshot["queueDepth"]) + 1
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
            self._status_store.update(
                phase="idle",
                scope=None,
                queueDepth=max(0, queue_depth - 1),
                processedFiles=1,
                totalFiles=1,
                activeNodeName="",
                error="",
            )
