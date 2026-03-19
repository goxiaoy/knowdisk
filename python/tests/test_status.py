from worker.runtime.status import IndexStatusStore, ModelStatusStore, VectorStatusStore


def test_model_status_store_exposes_default_snapshot():
    store = ModelStatusStore(event_sink=lambda event: None)

    assert store.snapshot() == {
        "phase": "idle",
        "progressPct": 0,
        "error": "",
        "available": False,
        "tasks": {
            "embedding": None,
            "reranker": None,
        },
    }


def test_index_status_store_updates_snapshot_and_emits_event():
    emitted: list[dict] = []
    store = IndexStatusStore(event_sink=emitted.append)

    snapshot = store.update(phase="indexing", scope="incremental", activeNodeName="hello.md")

    assert snapshot == {
        "available": True,
        "phase": "indexing",
        "scope": "incremental",
        "queueDepth": 0,
        "processedFiles": 0,
        "totalFiles": 0,
        "activeNodeName": "hello.md",
        "error": "",
    }
    assert emitted == [
        {
            "type": "index_status_changed",
            "payload": snapshot,
        }
    ]


def test_vector_status_store_tracks_extended_fields_and_emits_event():
    emitted: list[dict] = []
    store = VectorStatusStore(event_sink=emitted.append)

    snapshot = store.update(available=True, chunkCount=42, lastUpdatedAt="2026-03-17T16:00:00Z")

    assert snapshot == {
        "available": True,
        "chunkCount": 42,
        "lastUpdatedAt": "2026-03-17T16:00:00Z",
        "error": "",
    }
    assert emitted == [
        {
            "type": "vector_status_changed",
            "payload": snapshot,
        }
    ]
