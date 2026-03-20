import json

from worker.parser.simple import parse_simple_document


def test_markdown_input_produces_normalized_chunks():
    chunks = parse_simple_document(
        node={
            "nodeId": "node-1",
            "name": "hello.md",
            "kind": "file",
        },
        content=(
            "# Hello\n\n"
            + ("Alpha sentence. " * 60)
            + "\n\n## Next\n\n"
            + ("Beta sentence. " * 60)
        ).encode("utf-8"),
    )

    assert len(chunks) == 2
    assert [chunk["chunkIndex"] for chunk in chunks] == [0, 1]
    assert all(chunk["status"] == "ok" for chunk in chunks)
    assert chunks[0]["text"].startswith("# Hello")
    assert "Alpha sentence." in chunks[0]["text"]
    assert chunks[1]["text"].startswith("## Next")
    assert "Beta sentence." in chunks[1]["text"]
    assert all(chunk["title"] == "hello" for chunk in chunks)
    assert all(
        chunk["source"] == {
            "nodeId": "node-1",
            "name": "hello.md",
        }
        for chunk in chunks
    )


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


def test_markdown_short_blocks_merge_forward_within_section():
    chunks = parse_simple_document(
        node={
            "nodeId": "node-merge-1",
            "name": "merge.md",
            "kind": "file",
        },
        content=(
            "# Merge\n\n"
            "Tiny intro.\n\n"
            + ("This paragraph carries the section and should merge. " * 30)
        ).encode("utf-8"),
    )

    assert len(chunks) == 1
    assert chunks[0]["status"] == "ok"
    assert "Tiny intro." in chunks[0]["text"]
    assert "This paragraph carries the section and should merge." in chunks[0]["text"]


def test_markdown_long_paragraph_splits_into_multiple_chunks():
    chunks = parse_simple_document(
        node={
            "nodeId": "node-split-1",
            "name": "split.md",
            "kind": "file",
        },
        content=(
            "# Split\n\n"
            + " ".join(f"Sentence {index} has enough words to stay meaningful." for index in range(220))
        ).encode("utf-8"),
    )

    assert len(chunks) > 1
    assert chunks[0]["text"].startswith("# Split")
    assert all(chunk["status"] == "ok" for chunk in chunks)
    assert all(len(chunk["text"]) > 0 for chunk in chunks)


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
