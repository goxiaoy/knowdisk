from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from tempfile import gettempdir

from worker.index.queue_store import QueueJob, SQLiteIndexQueueStore
from worker.runtime.status import IndexStatusStore
from worker.runtime.types import DeleteNodeRequest, IndexNodeRequest, IndexStatusSnapshot


class IndexQueue:
    def __init__(
        self,
        status_store: IndexStatusStore,
        queue_store: SQLiteIndexQueueStore | None = None,
        notify_work_available: Callable[[], None] | None = None,
    ) -> None:
        self._status_store = status_store
        self._queue_store = (
            queue_store
            if queue_store is not None
            else SQLiteIndexQueueStore(_default_queue_db_path())
        )
        self._notify_work_available = notify_work_available or (lambda: None)

    def set_storage_base_path(self, base_path: Path) -> None:
        self._queue_store = SQLiteIndexQueueStore(base_path / "index" / "index.sqlite3")

    def snapshot(self) -> IndexStatusSnapshot:
        return self._queue_store.snapshot()

    def enqueue_incremental(self, request: IndexNodeRequest) -> None:
        self._queue_store.enqueue_job(
            request.node.node_id,
            "index",
            queue_kind="text",
            payload_json=json.dumps(request.to_mapping(), ensure_ascii=True),
        )
        self._publish_status_snapshot(self._queue_store.snapshot())
        self._notify_work_available()

    def enqueue_delete(self, request: DeleteNodeRequest) -> None:
        self._queue_store.enqueue_job(
            request.node_id,
            "delete",
            queue_kind="delete",
            payload_json=json.dumps(request.to_mapping(), ensure_ascii=True),
        )
        self._publish_status_snapshot(self._queue_store.snapshot())
        self._notify_work_available()

    def requeue_orphaned_running_jobs(self) -> None:
        self._queue_store.requeue_orphaned_running_jobs()
        self._publish_status_snapshot(self._queue_store.snapshot())

    def claim_next_job(self) -> QueueJob | None:
        claim = self._queue_store.claim_next_job()
        self._publish_status_snapshot(self._queue_store.snapshot())
        return claim.job

    def mark_done(self, job_id: int) -> None:
        self._queue_store.mark_done(job_id)
        self._publish_status_snapshot(self._queue_store.snapshot())

    def mark_failed(self, job_id: int, error: str) -> None:
        self._queue_store.mark_failed(job_id, error)
        self._publish_status_snapshot(self._queue_store.snapshot())

    def _publish_status_snapshot(self, snapshot: IndexStatusSnapshot) -> None:
        self._status_store.update(
            phase=snapshot["phase"],
            scope=snapshot["scope"],
            queueDepth=snapshot["queueDepth"],
            processedFiles=snapshot["processedFiles"],
            totalFiles=snapshot["totalFiles"],
            activeNodeName=snapshot["activeNodeName"],
            error=snapshot["error"],
            available=snapshot["available"],
        )


def _default_queue_db_path() -> Path:
    return Path(gettempdir()) / "knowdisk-python-worker" / "index" / "index.sqlite3"
