from worker.protocol.server import create_server
from worker.runtime.types import DeleteNodeRequest, IndexNodeRequest, IndexNodeResult


def test_start_returns_handshake_and_emits_health_event():
    emitted: list[dict] = []
    server = create_server(event_sink=emitted.append)

    response = server.handle_request(
        {
            "id": "req-1",
            "method": "start",
            "params": {
                "basePath": "/tmp/knowdisk",
                "embeddingModel": "Alibaba-NLP/gte-multilingual-base",
                "rerankerModel": "Alibaba-NLP/gte-multilingual-reranker-base",
                "preferredDevice": "cpu",
            },
        }
    )

    assert response == {
        "id": "req-1",
        "result": {
            "ok": True,
            "worker": "knowdisk-python-worker",
            "version": "0.1.0",
        },
    }
    assert server.model_runtime_config.embedding_model == "Alibaba-NLP/gte-multilingual-base"
    assert server.model_runtime_config.reranker_model == "Alibaba-NLP/gte-multilingual-reranker-base"
    assert server.model_runtime_config.preferred_device == "cpu"
    assert str(server.model_runtime_config.base_path) == "/tmp/knowdisk"
    assert str(server.model_runtime_config.model_cache_dir) == "/tmp/knowdisk/model"
    assert emitted == [
        {
            "type": "worker_health_changed",
            "payload": {
                "ready": True,
            },
        }
    ]


def test_shutdown_returns_ok_and_marks_server_stopped():
    server = create_server(event_sink=lambda event: None)

    response = server.handle_request({"id": "req-2", "method": "shutdown", "params": {}})

    assert response == {"id": "req-2", "result": {"ok": True}}
    assert server.is_running is False


def test_unknown_method_returns_error_response():
    server = create_server(event_sink=lambda event: None)

    response = server.handle_request({"id": "req-3", "method": "missing", "params": {}})

    assert response == {
        "id": "req-3",
        "error": {
            "code": "METHOD_NOT_FOUND",
            "message": "Unknown method: missing",
        },
    }


def test_get_status_snapshot_reads_from_attached_services():
    model_service = type("ModelServiceStub", (), {"snapshot": lambda self: {"phase": "completed"}})()
    index_queue = type("IndexQueueStub", (), {"snapshot": lambda self: {"phase": "idle"}})()
    index_service = type(
        "IndexServiceStub",
        (),
        {"vector_status_snapshot": lambda self: {"chunkCount": 3}},
    )()
    server = create_server(
        event_sink=lambda event: None,
        services={
            "model_service": model_service,
            "index_queue": index_queue,
            "index_service": index_service,
        },
    )

    response = server.handle_request({"id": "req-4", "method": "get_status_snapshot", "params": {}})

    assert response == {
        "id": "req-4",
        "result": {
            "model_status": {"phase": "completed"},
            "index_status": {"phase": "idle"},
            "vector_status": {"chunkCount": 3},
        },
    }


def test_index_node_delegates_to_index_service():
    calls: list[tuple[ParserNode, ParserMount]] = []
    queued: list[str] = []

    class IndexServiceStub:
        def index_node(self, request):
            calls.append((request.node, request.mount))
            return IndexNodeResult(indexed=1)

        def vector_status_snapshot(self):
            return {"chunkCount": 0}

    server = create_server(
        event_sink=lambda event: None,
        services={
            "model_service": type("ModelServiceStub", (), {"snapshot": lambda self: {}})(),
            "index_queue": type(
                "IndexQueueStub",
                (),
                {
                    "snapshot": lambda self: {},
                    "enqueue_incremental": lambda self, request: queued.append(request.node.node_id),
                },
            )(),
            "index_service": IndexServiceStub(),
        },
    )

    response = server.handle_request(
        {
            "id": "req-5",
            "method": "index_node",
            "params": {
                "node": {"nodeId": "node-1", "name": "a.md"},
                "mount": {"syncedContentPath": "", "localFilePath": "/tmp/a.md"},
            },
        }
    )

    assert response == {"id": "req-5", "result": {"queued": True}}
    assert queued == ["node-1"]
    assert calls == []


def test_index_node_queues_by_node_id_not_file_name():
    queued: list[str] = []

    class IndexServiceStub:
        def index_node(self, request):
            return IndexNodeResult(indexed=1)

        def vector_status_snapshot(self):
            return {"chunkCount": 0}

    server = create_server(
        event_sink=lambda event: None,
        services={
            "model_service": type("ModelServiceStub", (), {"snapshot": lambda self: {}})(),
            "index_queue": type(
                "IndexQueueStub",
                (),
                {
                    "snapshot": lambda self: {"phase": "idle"},
                    "enqueue_incremental": lambda self, request: queued.append(request.node.node_id),
                },
            )(),
            "index_service": IndexServiceStub(),
        },
    )

    first_response = server.handle_request(
        {
            "id": "req-6",
            "method": "index_node",
            "params": {
                "node": {"nodeId": "node-a", "name": "shared.md"},
                "mount": {"syncedContentPath": "", "localFilePath": "/tmp/a.md"},
            },
        }
    )
    second_response = server.handle_request(
        {
            "id": "req-7",
            "method": "index_node",
            "params": {
                "node": {"nodeId": "node-b", "name": "shared.md"},
                "mount": {"syncedContentPath": "", "localFilePath": "/tmp/b.md"},
            },
        }
    )

    assert first_response == {"id": "req-6", "result": {"queued": True}}
    assert second_response == {"id": "req-7", "result": {"queued": True}}
    assert queued == ["node-a", "node-b"]


def test_delete_node_enqueues_fifo_delete_job_instead_of_running_immediately():
    queued: list[tuple[str, str]] = []
    deleted: list[str] = []

    class IndexServiceStub:
        def delete_node(self, node_id):
            deleted.append(node_id)

        def search(self, query, title_only=False):
            return {"query": query, "titleOnly": title_only, "debug": {"finalResults": [{"nodeId": "node-1"}]}}

        def vector_status_snapshot(self):
            return {"chunkCount": 0}

    class IndexQueueStub:
        def snapshot(self):
            return {"phase": "idle"}

        def enqueue_delete(self, request):
            queued.append(("delete", request.node_id))

    server = create_server(
        event_sink=lambda event: None,
        services={
            "model_service": type("ModelServiceStub", (), {"snapshot": lambda self: {}})(),
            "index_queue": IndexQueueStub(),
            "index_service": IndexServiceStub(),
        },
    )

    response = server.handle_request(
        {"id": "req-8", "method": "delete_node", "params": {"nodeId": "node-1"}}
    )

    assert response == {"id": "req-8", "result": {"ok": True}}
    assert queued == [("delete", "node-1")]
    assert deleted == []


def test_delete_node_and_search_delegate_to_services():
    deleted: list[str] = []
    queued: list[tuple[str, str]] = []
    searched: list[tuple[str, bool]] = []

    class IndexServiceStub:
        def delete_node(self, node_id):
            deleted.append(node_id)

        def search(self, query, title_only=False):
            searched.append((query, title_only))
            return {"query": query, "titleOnly": title_only, "debug": {"finalResults": [{"nodeId": "node-1"}]}}

        def vector_status_snapshot(self):
            return {"chunkCount": 0}

    class IndexQueueStub:
        def snapshot(self):
            return {"phase": "idle"}

        def enqueue_delete(self, request):
            queued.append(("delete", request.node_id))

    server = create_server(
        event_sink=lambda event: None,
        services={
            "model_service": type("ModelServiceStub", (), {"snapshot": lambda self: {}})(),
            "index_queue": IndexQueueStub(),
            "index_service": IndexServiceStub(),
        },
    )

    delete_response = server.handle_request(
        {"id": "req-6", "method": "delete_node", "params": {"nodeId": "node-1"}}
    )
    search_response = server.handle_request(
        {"id": "req-7", "method": "search", "params": {"query": "hello", "titleOnly": True}}
    )

    assert delete_response == {"id": "req-6", "result": {"ok": True}}
    assert search_response == {
        "id": "req-7",
        "result": {"query": "hello", "titleOnly": True, "debug": {"finalResults": [{"nodeId": "node-1"}]}},
    }
    assert queued == [("delete", "node-1")]
    assert deleted == []
    assert searched == [("hello", True)]
