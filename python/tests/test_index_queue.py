from worker.index_queue import IndexQueue
from worker.status import IndexStatusStore


def test_incremental_jobs_execute_serially_and_update_queue_depth():
    emitted: list[dict] = []
    store = IndexStatusStore(event_sink=emitted.append)
    executed: list[str] = []
    queue = IndexQueue(status_store=store)

    queue.enqueue_incremental("a.md", lambda: executed.append("a"))
    queue.enqueue_incremental("b.md", lambda: executed.append("b"))

    assert executed == ["a", "b"]
    assert queue.snapshot()["queueDepth"] == 0
    assert queue.snapshot()["phase"] == "idle"
