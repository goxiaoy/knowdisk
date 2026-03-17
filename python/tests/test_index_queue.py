from worker.index_queue import IndexQueue
from worker.status import IndexStatusStore


def test_incremental_jobs_execute_serially_and_update_queue_depth():
    emitted: list[dict] = []
    store = IndexStatusStore(event_sink=emitted.append)
    executed: list[str] = []
    queue = IndexQueue(status_store=store, rebuild_concurrency=2)

    queue.enqueue_incremental("a.md", lambda: executed.append("a"))
    queue.enqueue_incremental("b.md", lambda: executed.append("b"))

    assert executed == ["a", "b"]
    assert queue.snapshot()["queueDepth"] == 0
    assert queue.snapshot()["phase"] == "idle"


def test_rebuild_updates_processed_counts_and_total_files():
    emitted: list[dict] = []
    store = IndexStatusStore(event_sink=emitted.append)
    processed: list[str] = []
    queue = IndexQueue(status_store=store, rebuild_concurrency=2)

    queue.rebuild_all(
        [
            ("one.md", lambda: processed.append("one")),
            ("two.md", lambda: processed.append("two")),
            ("three.md", lambda: processed.append("three")),
        ]
    )

    assert processed == ["one", "two", "three"]
    assert queue.snapshot()["processedFiles"] == 3
    assert queue.snapshot()["totalFiles"] == 3
    assert queue.snapshot()["phase"] == "idle"


def test_rebuild_failures_do_not_abort_remaining_jobs():
    store = IndexStatusStore(event_sink=lambda event: None)
    processed: list[str] = []
    queue = IndexQueue(status_store=store, rebuild_concurrency=2)

    def fail() -> None:
        raise RuntimeError("boom")

    queue.rebuild_all(
        [
            ("one.md", lambda: processed.append("one")),
            ("bad.md", fail),
            ("three.md", lambda: processed.append("three")),
        ]
    )

    assert processed == ["one", "three"]
    assert queue.snapshot()["processedFiles"] == 3
    assert queue.snapshot()["phase"] == "idle"


def test_cancel_stops_future_work():
    store = IndexStatusStore(event_sink=lambda event: None)
    processed: list[str] = []
    queue = IndexQueue(status_store=store, rebuild_concurrency=2)

    def stop_after_first() -> None:
        processed.append("one")
        queue.cancel()

    queue.rebuild_all(
        [
            ("one.md", stop_after_first),
            ("two.md", lambda: processed.append("two")),
        ]
    )

    assert processed == ["one"]
