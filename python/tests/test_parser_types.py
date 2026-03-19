from worker.parser.types import (
    ParsedChunk,
    ParsedChunkError,
    ParsedSource,
    ParserMount,
    ParserNode,
)


def test_parser_domain_models_normalize_mapping_inputs():
    node = ParserNode.from_mapping(
        {
            "nodeId": "node-1",
            "name": "notes.md",
            "sourceRef": "notes.md",
            "providerType": "local",
            "mountId": "mount-1",
        }
    )
    mount = ParserMount.from_mapping(
        {
            "directory": "/tmp/mount",
            "contentDir": "/tmp/content",
            "providerType": "local",
        }
    )

    assert node.node_id == "node-1"
    assert node.name == "notes.md"
    assert node.source_ref == "notes.md"
    assert node.provider_type == "local"
    assert node.mount_id == "mount-1"
    assert mount.directory == "/tmp/mount"
    assert mount.content_dir == "/tmp/content"


def test_parsed_chunk_to_legacy_dict_round_trips_nested_source_and_error():
    chunk = ParsedChunk(
        status="error",
        chunk_index=0,
        text="",
        title="notes",
        source=ParsedSource(node_id="node-1", name="notes.md", path="/tmp/mount/notes.md"),
        error=ParsedChunkError(code="BROKEN", message="boom"),
    )

    assert chunk.to_legacy_dict() == {
        "status": "error",
        "chunkIndex": 0,
        "text": "",
        "title": "notes",
        "source": {
            "nodeId": "node-1",
            "name": "notes.md",
            "path": "/tmp/mount/notes.md",
        },
        "error": {
            "code": "BROKEN",
            "message": "boom",
        },
    }
