import threading
from pathlib import Path

import worker.index.queue as queue_module
import worker.index.queue_store as queue_store_module
from worker.index.queue import IndexQueue
from worker.index.queue_store import SQLiteIndexQueueStore
from worker.runtime.status import IndexStatusStore


def test_incremental_jobs_execute_serially_and_update_queue_depth(tmp_path: Path):
    emitted: list[dict] = []
    store = IndexStatusStore(event_sink=emitted.append)
    executed: list[str] = []
    queue = IndexQueue(
        status_store=store,
        queue_store=SQLiteIndexQueueStore(tmp_path / "index-queue.sqlite3"),
    )

    queue.enqueue_incremental("a.md", lambda: executed.append("a"))
    queue.enqueue_incremental("b.md", lambda: executed.append("b"))

    assert executed == ["a", "b"]
    assert queue.snapshot()["queueDepth"] == 0
    assert queue.snapshot()["phase"] == "idle"


def test_queue_snapshot_is_persisted_in_sqlite_between_instances(tmp_path: Path):
    db_path = tmp_path / "index-queue.sqlite3"
    first_store = SQLiteIndexQueueStore(db_path)
    first_store.update(
        phase="indexing",
        scope="incremental",
        queueDepth=3,
        processedFiles=0,
        totalFiles=1,
        activeNodeName="a.md",
        error="",
    )

    second_store = SQLiteIndexQueueStore(db_path)

    assert second_store.snapshot() == {
        "available": True,
        "phase": "indexing",
        "scope": "incremental",
        "queueDepth": 3,
        "processedFiles": 0,
        "totalFiles": 1,
        "activeNodeName": "a.md",
        "error": "",
    }


def test_incremental_jobs_persist_through_index_queue_instances(tmp_path: Path):
    emitted: list[dict] = []
    status_store = IndexStatusStore(event_sink=emitted.append)
    queue_store = SQLiteIndexQueueStore(tmp_path / "index-queue.sqlite3")
    first_queue = IndexQueue(status_store=status_store, queue_store=queue_store)
    snapshots: list[dict] = []

    def job() -> None:
        second_queue = IndexQueue(
            status_store=IndexStatusStore(event_sink=lambda event: None),
            queue_store=SQLiteIndexQueueStore(tmp_path / "index-queue.sqlite3"),
        )
        snapshots.append(second_queue.snapshot())

    first_queue.enqueue_incremental("a.md", job)

    assert snapshots == [
        {
            "available": True,
            "phase": "indexing",
            "scope": "incremental",
            "queueDepth": 1,
            "processedFiles": 0,
            "totalFiles": 1,
            "activeNodeName": "a.md",
            "error": "",
        }
    ]
    assert first_queue.snapshot() == {
        "available": True,
        "phase": "idle",
        "scope": None,
        "queueDepth": 0,
        "processedFiles": 1,
        "totalFiles": 1,
        "activeNodeName": "",
        "error": "",
    }


def test_incremental_completion_event_matches_persisted_non_idle_snapshot_when_queue_depth_remains(
    tmp_path: Path,
):
    emitted: list[dict] = []
    queue_store = SQLiteIndexQueueStore(tmp_path / "index-queue.sqlite3")
    queue_store.update(
        phase="indexing",
        scope="incremental",
        queueDepth=1,
        processedFiles=0,
        totalFiles=1,
        activeNodeName="seed.md",
        error="",
    )
    queue = IndexQueue(
        status_store=IndexStatusStore(event_sink=emitted.append),
        queue_store=queue_store,
    )

    queue.enqueue_incremental("a.md", lambda: None)

    assert emitted[-1]["payload"] == {
        "available": True,
        "phase": "indexing",
        "scope": "incremental",
        "queueDepth": 1,
        "processedFiles": 0,
        "totalFiles": 1,
        "activeNodeName": "a.md",
        "error": "",
    }
    assert queue.snapshot() == emitted[-1]["payload"]


def test_default_queue_path_is_shared_between_index_queue_instances(
    monkeypatch, tmp_path: Path
):
    monkeypatch.setattr(queue_module, "gettempdir", lambda: str(tmp_path))

    first_queue = IndexQueue(status_store=IndexStatusStore(event_sink=lambda event: None))
    snapshots: list[dict] = []

    def job() -> None:
        second_queue = IndexQueue(
            status_store=IndexStatusStore(event_sink=lambda event: None),
        )
        snapshots.append(second_queue.snapshot())

    first_queue.enqueue_incremental("a.md", job)

    assert snapshots == [
        {
            "available": True,
            "phase": "indexing",
            "scope": "incremental",
            "queueDepth": 1,
            "processedFiles": 0,
            "totalFiles": 1,
            "activeNodeName": "a.md",
            "error": "",
        }
    ]


def test_shared_sqlite_queue_depth_updates_are_atomic(tmp_path: Path):
    db_path = tmp_path / "index-queue.sqlite3"
    start_barrier = threading.Barrier(2)
    job_barrier = threading.Barrier(2)
    original_snapshot = SQLiteIndexQueueStore.snapshot
    call_count = {"value": 0}
    call_lock = threading.Lock()

    def snapshot_with_barrier(self: SQLiteIndexQueueStore) -> dict:
        snapshot = original_snapshot(self)
        with call_lock:
            call_count["value"] += 1
            should_wait = call_count["value"] <= 2
        if should_wait:
            start_barrier.wait(timeout=5)
        return snapshot

    queue_module.SQLiteIndexQueueStore.snapshot = snapshot_with_barrier  # type: ignore[assignment]
    try:
        queue_a = IndexQueue(
            status_store=IndexStatusStore(event_sink=lambda event: None),
            queue_store=SQLiteIndexQueueStore(db_path),
        )
        queue_b = IndexQueue(
            status_store=IndexStatusStore(event_sink=lambda event: None),
            queue_store=SQLiteIndexQueueStore(db_path),
        )
        observed_depths: list[int] = []
        errors: list[BaseException] = []

        def make_job(queue: IndexQueue):
            def job() -> None:
                job_barrier.wait(timeout=5)
                observed_depths.append(queue.snapshot()["queueDepth"])

            return job

        def run(queue: IndexQueue, name: str) -> None:
            try:
                queue.enqueue_incremental(name, make_job(queue))
            except BaseException as exc:  # pragma: no cover - diagnostic path
                errors.append(exc)

        thread_a = threading.Thread(target=run, args=(queue_a, "a.md"))
        thread_b = threading.Thread(target=run, args=(queue_b, "b.md"))
        thread_a.start()
        thread_b.start()
        thread_a.join(timeout=5)
        thread_b.join(timeout=5)

        assert errors == []
        assert observed_depths == [2, 2]
        assert queue_a.snapshot() == {
            "available": True,
            "phase": "idle",
            "scope": None,
            "queueDepth": 0,
            "processedFiles": 1,
            "totalFiles": 1,
            "activeNodeName": "",
            "error": "",
        }
    finally:
        queue_module.SQLiteIndexQueueStore.snapshot = original_snapshot  # type: ignore[assignment]


def test_stale_persisted_indexing_snapshot_is_reset_on_fresh_store_initialization(
    tmp_path: Path,
):
    db_path = tmp_path / "index-queue.sqlite3"
    first_store = SQLiteIndexQueueStore(db_path)
    first_store.update(
        phase="indexing",
        scope="incremental",
        queueDepth=2,
        processedFiles=0,
        totalFiles=1,
        activeNodeName="stale.md",
        error="",
    )

    queue_store_module._INITIALIZED_QUEUE_PATHS.clear()
    second_store = SQLiteIndexQueueStore(db_path)

    assert second_store.snapshot() == {
        "available": False,
        "phase": "idle",
        "scope": None,
        "queueDepth": 0,
        "processedFiles": 0,
        "totalFiles": 0,
        "activeNodeName": "",
        "error": "",
    }
