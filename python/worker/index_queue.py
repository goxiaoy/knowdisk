from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Any

from worker.status import IndexStatusStore


Job = Callable[[], None]


class IndexQueue:
    def __init__(self, status_store: IndexStatusStore, rebuild_concurrency: int) -> None:
        self._status_store = status_store
        self._rebuild_concurrency = max(1, rebuild_concurrency)
        self._cancelled = False

    def snapshot(self) -> dict[str, Any]:
        return self._status_store.snapshot()

    def cancel(self) -> None:
        self._cancelled = True

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

    def rebuild_all(self, jobs: Iterable[tuple[str, Job]]) -> None:
        items = list(jobs)
        self._cancelled = False
        total_files = len(items)
        processed = 0
        self._status_store.update(
            phase="rebuilding",
            scope="full",
            queueDepth=total_files,
            processedFiles=0,
            totalFiles=total_files,
            activeNodeName="",
            error="",
        )

        for node_name, job in items:
            if self._cancelled:
                break
            self._status_store.update(
                phase="rebuilding",
                scope="full",
                queueDepth=max(0, total_files - processed - 1),
                processedFiles=processed,
                totalFiles=total_files,
                activeNodeName=node_name,
                error="",
            )
            try:
                job()
            except Exception:
                pass
            processed += 1

        self._status_store.update(
            phase="idle",
            scope=None,
            queueDepth=0,
            processedFiles=processed,
            totalFiles=total_files,
            activeNodeName="",
            error="",
        )
