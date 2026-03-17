from pathlib import Path

from worker.bun_client import BunClient


def test_get_node_metadata_delegates_to_request_callback():
    calls: list[tuple[str, dict]] = []

    client = BunClient(
        request=lambda method, params: calls.append((method, params)) or {"nodeId": "node-1"}
    )

    result = client.get_node_metadata("node-1")

    assert result == {"nodeId": "node-1"}
    assert calls == [("get_node_metadata", {"nodeId": "node-1"})]


def test_read_node_content_returns_bytes_from_request_callback():
    client = BunClient(
        request=lambda method, params: {
            "content": "aGVsbG8=",
        }
    )

    result = client.read_node_content("node-1")

    assert result == b"hello"


def test_materialize_node_file_writes_temp_file_and_cleans_up():
    client = BunClient(
        request=lambda method, params: {
            "content": "aGVsbG8=",
        }
    )

    with client.materialize_node_file("node-1", suffix=".md") as path:
        temp_path = Path(path)
        assert temp_path.exists()
        assert temp_path.read_bytes() == b"hello"

    assert temp_path.exists() is False
