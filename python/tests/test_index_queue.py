from pathlib import Path

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
