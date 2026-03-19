from worker.runtime.types import (
    create_default_index_status_snapshot,
    create_default_model_status_snapshot,
    create_default_vector_status_snapshot,
    parse_delete_node_request,
    parse_index_node_request,
    parse_search_request,
)


def test_status_snapshot_factories_return_expected_defaults():
    assert create_default_model_status_snapshot() == {
        "phase": "idle",
        "progressPct": 0,
        "error": "",
        "available": False,
        "tasks": {
            "embedding": None,
            "reranker": None,
        },
    }
    assert create_default_index_status_snapshot() == {
        "available": False,
        "phase": "idle",
        "scope": None,
        "queueDepth": 0,
        "processedFiles": 0,
        "totalFiles": 0,
        "activeNodeName": "",
        "error": "",
    }
    assert create_default_vector_status_snapshot() == {
        "available": False,
        "chunkCount": None,
        "lastUpdatedAt": "",
        "error": "",
    }


def test_request_parsers_normalize_server_params():
    index_request = parse_index_node_request(
        {
            "node": {
                "nodeId": "node-1",
                "name": "hello.md",
                "sourceRef": "hello.md",
                "providerType": "local",
                "mountId": "mount-1",
            },
            "mount": {
                "directory": "/tmp/mount",
                "contentDir": "/tmp/content",
                "providerType": "local",
            },
        }
    )
    delete_request = parse_delete_node_request({"nodeId": "node-2"})
    search_request = parse_search_request({"query": "hello"})

    assert index_request.node.node_id == "node-1"
    assert index_request.mount.content_dir == "/tmp/content"
    assert delete_request.node_id == "node-2"
    assert search_request.query == "hello"
