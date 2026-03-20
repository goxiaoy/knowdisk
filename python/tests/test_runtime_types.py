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
                "syncedContentPath": "/tmp/content/hello.md",
                "localFilePath": "/tmp/mount/hello.md",
                "providerType": "local",
            },
        }
    )
    delete_request = parse_delete_node_request({"nodeId": "node-2"})
    search_request = parse_search_request({"query": "hello", "titleOnly": True})
    default_search_request = parse_search_request({"query": "world"})

    assert index_request.node.node_id == "node-1"
    assert index_request.mount.synced_content_path == "/tmp/content/hello.md"
    assert index_request.mount.local_file_path == "/tmp/mount/hello.md"
    assert delete_request.node_id == "node-2"
    assert search_request.query == "hello"
    assert search_request.title_only is True
    assert default_search_request.title_only is False


def test_search_response_debug_payload_types_are_structured():
    from worker.runtime.types import SearchResponseDebugPayload, SearchResponsePayload

    debug_payload: SearchResponseDebugPayload = {
        "ftsResults": [],
        "vectorResults": [],
        "mergedCandidates": [],
        "rerankedResults": [],
        "finalResults": [],
    }
    response_payload: SearchResponsePayload = {
        "query": "hello",
        "titleOnly": True,
        "debug": debug_payload,
    }

    assert response_payload["query"] == "hello"
    assert response_payload["titleOnly"] is True
    assert response_payload["debug"]["finalResults"] == []
