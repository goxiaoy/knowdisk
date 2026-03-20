import json

from worker.parser.simple import parse_simple_document


def test_markdown_input_produces_normalized_chunks():
    chunks = parse_simple_document(
        node={
            "nodeId": "node-1",
            "name": "hello.md",
            "kind": "file",
        },
        content=b"# Hello\n\nWorld",
    )

    assert chunks == [
        {
            "status": "ok",
            "chunkIndex": 0,
            "text": "# Hello\n\nWorld",
            "title": "hello",
            "source": {
                "nodeId": "node-1",
                "name": "hello.md",
            },
        }
    ]


def test_plain_text_input_produces_normalized_chunks():
    chunks = parse_simple_document(
        node={
            "nodeId": "node-2",
            "name": "notes.txt",
            "kind": "file",
        },
        content=b"plain text",
    )

    assert chunks == [
        {
            "status": "ok",
            "chunkIndex": 0,
            "text": "plain text",
            "title": "notes",
            "source": {
                "nodeId": "node-2",
                "name": "notes.txt",
            },
        }
    ]


def test_json_input_is_rendered_as_deterministic_text():
    chunks = parse_simple_document(
        node={
            "nodeId": "node-3",
            "name": "info.json",
            "kind": "file",
        },
        content=b'{"b":2,"a":1}',
    )

    assert chunks == [
        {
            "status": "ok",
            "chunkIndex": 0,
            "text": json.dumps({"a": 1, "b": 2}, ensure_ascii=True, indent=2, sort_keys=True),
            "title": "info",
            "source": {
                "nodeId": "node-3",
                "name": "info.json",
            },
        }
    ]


def test_empty_content_produces_skipped_result():
    chunks = parse_simple_document(
        node={
            "nodeId": "node-4",
            "name": "empty.txt",
            "kind": "file",
        },
        content=b"   ",
    )

    assert chunks == [
        {
            "status": "skipped",
            "chunkIndex": 0,
            "text": "",
            "title": "empty",
            "source": {
                "nodeId": "node-4",
                "name": "empty.txt",
            },
            "error": {
                "code": "EMPTY_CONTENT",
                "message": "simple parser content is empty",
            },
        }
    ]
