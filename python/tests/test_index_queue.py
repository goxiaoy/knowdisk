import sqlite3
import threading
from pathlib import Path

from worker.index.queue import IndexQueue
from worker.index.queue_store import SQLiteIndexQueueStore
from worker.runtime.status import IndexStatusStore


def test_fifo_jobs_run_in_enqueue_order_and_queue_depth_comes_from_sqlite(
    tmp_path: Path,
):
    db_path = tmp_path / "index-queue.sqlite3"
    first_started = threading.Event()
    release_first = threading.Event()
    executed: list[str] = []
    queue = IndexQueue(
        status_store=IndexStatusStore(event_sink=lambda event: None),
        queue_store=SQLiteIndexQueueStore(db_path),
    )

    def first_job() -> None:
        executed.append("a-start")
        first_started.set()
        release_first.wait(timeout=5)
        executed.append("a-end")

    thread = threading.Thread(
        target=lambda: queue.enqueue_incremental("a.md", first_job),
        daemon=True,
    )
    thread.start()
    assert first_started.wait(timeout=5)

    queue.enqueue_incremental("b.md", lambda: executed.append("b"))

    with sqlite3.connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT status, COUNT(*)
            FROM index_jobs
            GROUP BY status
            """
        ).fetchall()
    assert dict(rows) == {"running": 1, "queued": 1}
    assert queue.snapshot()["queueDepth"] == 1

    release_first.set()
    thread.join(timeout=5)

    assert executed == ["a-start", "a-end", "b"]
    assert queue.snapshot() == {
        "available": True,
        "phase": "idle",
        "scope": None,
        "queueDepth": 0,
        "processedFiles": 1,
        "totalFiles": 1,
        "activeNodeName": "",
        "error": "",
    }


def test_repeated_index_requests_for_same_node_coalesce_while_one_is_running(
    tmp_path: Path,
):
    db_path = tmp_path / "index-queue.sqlite3"
    first_started = threading.Event()
    release_first = threading.Event()
    executed: list[str] = []
    queue = IndexQueue(
        status_store=IndexStatusStore(event_sink=lambda event: None),
        queue_store=SQLiteIndexQueueStore(db_path),
    )

    def first_job() -> None:
        executed.append("a")
        first_started.set()
        release_first.wait(timeout=5)

    thread = threading.Thread(
        target=lambda: queue.enqueue_incremental("a.md", first_job),
        daemon=True,
    )
    thread.start()
    assert first_started.wait(timeout=5)

    queue.enqueue_incremental("a.md", lambda: executed.append("duplicate"))

    release_first.set()
    thread.join(timeout=5)

    assert executed == ["a"]
    with sqlite3.connect(db_path) as connection:
        count = connection.execute(
            "SELECT COUNT(*) FROM index_jobs WHERE node_id = ?",
            ("a.md",),
        ).fetchone()[0]
    assert count == 1
    assert queue.snapshot()["queueDepth"] == 0


def test_jobs_for_different_node_ids_with_same_name_do_not_coalesce(
    tmp_path: Path,
):
    db_path = tmp_path / "index-queue.sqlite3"
    shared_name = "shared.md"
    executed: list[str] = []
    queue = IndexQueue(
        status_store=IndexStatusStore(event_sink=lambda event: None),
        queue_store=SQLiteIndexQueueStore(db_path),
    )

    queue.enqueue_incremental("node-a", lambda: executed.append(f"{shared_name}:a"))
    queue.enqueue_incremental("node-b", lambda: executed.append(f"{shared_name}:b"))

    assert executed == ["shared.md:a", "shared.md:b"]
    with sqlite3.connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT node_id, job_type, status
            FROM index_jobs
            ORDER BY job_id
            """
        ).fetchall()
    assert rows == [
        ("node-a", "index", "done"),
        ("node-b", "index", "done"),
    ]


def test_delete_supersedes_stale_index_jobs_and_cancels_them_when_encountered(
    tmp_path: Path,
):
    db_path = tmp_path / "index-queue.sqlite3"
    blocker_started = threading.Event()
    release_blocker = threading.Event()
    executed: list[str] = []
    queue = IndexQueue(
        status_store=IndexStatusStore(event_sink=lambda event: None),
        queue_store=SQLiteIndexQueueStore(db_path),
    )

    def blocker() -> None:
        executed.append("block")
        blocker_started.set()
        release_blocker.wait(timeout=5)

    blocker_thread = threading.Thread(
        target=lambda: queue.enqueue_incremental("other.md", blocker),
        daemon=True,
    )
    blocker_thread.start()
    assert blocker_started.wait(timeout=5)

    queue.enqueue_incremental("node-a.md", lambda: executed.append("stale-index"))
    queue.enqueue_delete("node-a.md", lambda: executed.append("delete"))

    assert queue.snapshot()["queueDepth"] == 1
    release_blocker.set()
    blocker_thread.join(timeout=5)

    assert executed == ["block", "delete"]
    with sqlite3.connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT node_id, job_type, status
            FROM index_jobs
            ORDER BY job_id
            """
        ).fetchall()
    assert rows == [
        ("other.md", "index", "done"),
        ("node-a.md", "index", "cancelled"),
        ("node-a.md", "delete", "done"),
    ]


def test_second_store_cannot_promote_a_new_job_while_another_job_is_running(
    tmp_path: Path,
):
    db_path = tmp_path / "index-queue.sqlite3"
    first_store = SQLiteIndexQueueStore(db_path)
    second_store = SQLiteIndexQueueStore(db_path)
    first_store.enqueue_job("node-a.md", "index")
    first_store.enqueue_job("node-b.md", "index")

    first_claim = first_store.claim_next_job()
    assert first_claim.job is not None

    second_claim = second_store.claim_next_job()

    assert second_claim.job is None


def test_delete_does_not_preempt_a_running_index_job_for_the_same_node(
    tmp_path: Path,
):
    db_path = tmp_path / "index-queue.sqlite3"
    index_started = threading.Event()
    release_index = threading.Event()
    executed: list[str] = []
    queue = IndexQueue(
        status_store=IndexStatusStore(event_sink=lambda event: None),
        queue_store=SQLiteIndexQueueStore(db_path),
    )

    def index_job() -> None:
        executed.append("index-start")
        index_started.set()
        release_index.wait(timeout=5)
        executed.append("index-end")

    thread = threading.Thread(
        target=lambda: queue.enqueue_incremental("node-a.md", index_job),
        daemon=True,
    )
    thread.start()
    assert index_started.wait(timeout=5)

    queue.enqueue_delete("node-a.md", lambda: executed.append("delete"))

    assert queue.snapshot()["queueDepth"] == 1
    release_index.set()
    thread.join(timeout=5)

    assert executed == ["index-start", "index-end", "delete"]
