import sqlite3
from pathlib import Path

from worker.index.queue import IndexQueue
from worker.index.queue_store import SQLiteIndexQueueStore
from worker.runtime.status import IndexStatusStore
from worker.runtime.types import DeleteNodeRequest, IndexNodeRequest
from worker.parser.types import ParserMount, ParserNode


def test_default_queue_store_uses_index_sqlite_path(monkeypatch):
    monkeypatch.setattr("worker.index.queue.gettempdir", lambda: "/tmp/knowdisk-test")
    queue = IndexQueue(status_store=IndexStatusStore(event_sink=lambda event: None))

    assert queue._queue_store.db_path == Path("/tmp/knowdisk-test") / "knowdisk-python-worker" / "index" / "index.sqlite3"


def test_set_storage_base_path_moves_queue_store_into_index_sqlite(tmp_path: Path):
    queue = IndexQueue(status_store=IndexStatusStore(event_sink=lambda event: None))

    queue.set_storage_base_path(tmp_path)

    assert queue._queue_store.db_path == tmp_path / "index" / "index.sqlite3"


def test_enqueue_persists_job_and_notifies_worker_without_running_it(tmp_path: Path):
    db_path = tmp_path / "index-queue.sqlite3"
    wakeups: list[str] = []
    queue = IndexQueue(
        status_store=IndexStatusStore(event_sink=lambda event: None),
        queue_store=SQLiteIndexQueueStore(db_path),
        notify_work_available=lambda: wakeups.append("wake"),
    )

    queue.enqueue_incremental(_index_request("node-a", "a.md", "/tmp/a.md"))

    with sqlite3.connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT status, COUNT(*)
            FROM index_jobs
            GROUP BY status
            """
        ).fetchall()
    assert dict(rows) == {"queued": 1}
    assert queue.snapshot()["queueDepth"] == 1
    assert queue.snapshot()["phase"] == "indexing"
    assert wakeups == ["wake"]


def test_repeated_index_requests_for_same_node_coalesce_while_queued(tmp_path: Path):
    db_path = tmp_path / "index-queue.sqlite3"
    queue = IndexQueue(
        status_store=IndexStatusStore(event_sink=lambda event: None),
        queue_store=SQLiteIndexQueueStore(db_path),
    )

    queue.enqueue_incremental(_index_request("node-a", "a.md", "/tmp/a.md"))
    queue.enqueue_incremental(_index_request("node-a", "a.md", "/tmp/a.md"))

    with sqlite3.connect(db_path) as connection:
        count = connection.execute(
            "SELECT COUNT(*) FROM index_jobs WHERE node_id = ?",
            ("node-a",),
        ).fetchone()[0]
    assert count == 1
    assert queue.snapshot()["queueDepth"] == 1


def test_jobs_for_different_node_ids_with_same_name_do_not_coalesce(
    tmp_path: Path,
):
    db_path = tmp_path / "index-queue.sqlite3"
    shared_name = "shared.md"
    queue = IndexQueue(
        status_store=IndexStatusStore(event_sink=lambda event: None),
        queue_store=SQLiteIndexQueueStore(db_path),
    )

    queue.enqueue_incremental(_index_request("node-a", shared_name, "/tmp/a.md"))
    queue.enqueue_incremental(_index_request("node-b", shared_name, "/tmp/b.md"))

    with sqlite3.connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT node_id, job_type, status
            FROM index_jobs
            ORDER BY job_id
            """
        ).fetchall()
    assert rows == [
        ("node-a", "index", "queued"),
        ("node-b", "index", "queued"),
    ]


def test_delete_supersedes_stale_index_jobs_without_running_inline(tmp_path: Path):
    db_path = tmp_path / "index-queue.sqlite3"
    queue = IndexQueue(
        status_store=IndexStatusStore(event_sink=lambda event: None),
        queue_store=SQLiteIndexQueueStore(db_path),
    )

    queue.enqueue_incremental(_index_request("node-a.md", "node-a.md", "/tmp/a.md"))
    queue.enqueue_delete(DeleteNodeRequest(node_id="node-a.md"))

    assert queue.snapshot()["queueDepth"] == 1
    with sqlite3.connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT node_id, job_type, status
            FROM index_jobs
            ORDER BY job_id
            """
        ).fetchall()
    assert rows == [("node-a.md", "index", "queued"), ("node-a.md", "delete", "queued")]


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


def test_orphaned_running_jobs_are_requeued_on_startup(tmp_path: Path):
    db_path = tmp_path / "index-queue.sqlite3"
    queue_store = SQLiteIndexQueueStore(db_path)
    enqueue_result = queue_store.enqueue_job("node-a.md", "index")
    claimed = queue_store.claim_next_job()

    assert claimed.job is not None
    assert claimed.job.job_id == enqueue_result.job.job_id

    queue_store.requeue_orphaned_running_jobs()

    with sqlite3.connect(db_path) as connection:
        row = connection.execute(
            "SELECT status, started_at, finished_at FROM index_jobs WHERE job_id = ?",
            (enqueue_result.job.job_id,),
        ).fetchone()

    assert row == ("queued", None, None)


def test_snapshot_does_not_fallback_to_node_id_when_payload_has_no_name(tmp_path: Path):
    db_path = tmp_path / "index-queue.sqlite3"
    queue_store = SQLiteIndexQueueStore(db_path)
    queue_store.enqueue_job("node-legacy", "index", payload_json='{"node":{"nodeId":"node-legacy"}}')

    snapshot = queue_store.snapshot()

    assert snapshot["activeNodeName"] == ""


def _index_request(node_id: str, name: str, path: str) -> IndexNodeRequest:
    return IndexNodeRequest(
        node=ParserNode(
            node_id=node_id,
            mount_id="mount-1",
            name=name,
            source_ref=name,
            provider_type="local",
        ),
        mount=ParserMount(
            synced_content_path="",
            local_file_path=path,
            provider_type="local",
        ),
    )
