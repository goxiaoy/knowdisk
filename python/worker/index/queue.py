from __future__ import annotations

import threading
from collections.abc import Callable
from pathlib import Path
from tempfile import gettempdir

from worker.index.queue_store import QueueJob, SQLiteIndexQueueStore
from worker.runtime.status import IndexStatusStore
from worker.runtime.types import IndexStatusSnapshot


Job = Callable[[], None]

_PENDING_JOB_CALLABLES: dict[int, Job] = {}
_PENDING_JOB_CALLABLES_GUARD = threading.Lock()


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
        self._enqueue_job(node_name, "index", job)

    def enqueue_delete(self, node_name: str, job: Job) -> None:
        self._enqueue_job(node_name, "delete", job)

    def _enqueue_job(self, node_name: str, job_type: str, job: Job) -> None:
        enqueue_result = self._queue_store.enqueue_job(node_name, job_type)
        if enqueue_result.status == "queued":
            self._register_pending_job(enqueue_result.job, job)
        self._publish_status_snapshot(self._queue_store.snapshot())
        self._drain_if_possible()

    def _drain_if_possible(self) -> None:
        while True:
            claim = self._queue_store.claim_next_job()
            self._discard_cancelled_jobs(claim.cancelled_job_ids)
            if claim.job is None:
                self._publish_status_snapshot(self._queue_store.snapshot())
                return
            self._run_claimed_job(claim.job)

    def _run_claimed_job(self, job: QueueJob) -> None:
        self._publish_status_snapshot(self._queue_store.snapshot())
        callable_job = self._get_pending_job(job.job_id)
        try:
            if callable_job is None:
                raise RuntimeError(f"missing callable for queued job {job.job_id}")
            callable_job()
        except BaseException as exc:
            self._queue_store.mark_failed(job.job_id, str(exc))
        else:
            self._queue_store.mark_done(job.job_id)
        finally:
            self._remove_pending_job(job.job_id)
            self._publish_status_snapshot(self._queue_store.snapshot())

    def _register_pending_job(self, job: QueueJob, callable_job: Job) -> None:
        with _PENDING_JOB_CALLABLES_GUARD:
            _PENDING_JOB_CALLABLES[job.job_id] = callable_job

    def _get_pending_job(self, job_id: int) -> Job | None:
        with _PENDING_JOB_CALLABLES_GUARD:
            return _PENDING_JOB_CALLABLES.get(job_id)

    def _remove_pending_job(self, job_id: int) -> None:
        with _PENDING_JOB_CALLABLES_GUARD:
            _PENDING_JOB_CALLABLES.pop(job_id, None)

    def _discard_cancelled_jobs(self, cancelled_job_ids: tuple[int, ...]) -> None:
        if not cancelled_job_ids:
            return
        with _PENDING_JOB_CALLABLES_GUARD:
            for job_id in cancelled_job_ids:
                _PENDING_JOB_CALLABLES.pop(job_id, None)

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
    return Path(gettempdir()) / "knowdisk-python-worker" / "index-queue.sqlite3"
