from pathlib import Path

from worker.parser.types import ParserMount, ParserNode
from worker.parser_service import parse_node


def test_selects_simple_parser_for_markdown_local_node(tmp_path: Path):
    source_dir = tmp_path / "mount"
    source_dir.mkdir()
    source_file = source_dir / "notes.md"
    source_file.write_text("# Title\n\nHello", encoding="utf-8")

    chunks = parse_node(
        node={
            "nodeId": "node-1",
            "name": "notes.md",
            "providerType": "local",
            "sourceRef": "notes.md",
        },
        mount={
            "directory": str(source_dir),
            "contentDir": "",
        },
    )

    assert chunks[0]["status"] == "ok"
    assert chunks[0]["text"] == "# Title\n\nHello"
    assert chunks[0]["source"]["path"] == str(source_file)


def test_selects_simple_parser_for_typed_markdown_local_node(tmp_path: Path):
    source_dir = tmp_path / "mount"
    source_dir.mkdir()
    source_file = source_dir / "notes.md"
    source_file.write_text("# Title\n\nHello", encoding="utf-8")

    chunks = parse_node(
        node=ParserNode(
            node_id="node-typed-1",
            name="notes.md",
            source_ref="notes.md",
            provider_type="local",
            mount_id="mount-1",
        ),
        mount=ParserMount(
            directory=str(source_dir),
            content_dir="",
            provider_type="local",
        ),
    )

    assert chunks[0]["status"] == "ok"
    assert chunks[0]["text"] == "# Title\n\nHello"
    assert chunks[0]["source"]["path"] == str(source_file)


def test_selects_docling_for_pdf_local_node(tmp_path: Path):
    source_dir = tmp_path / "mount"
    source_dir.mkdir()
    source_file = source_dir / "paper.pdf"
    source_file.write_bytes(b"%PDF-1.7")

    chunks = parse_node(
        node={
            "nodeId": "node-2",
            "name": "paper.pdf",
            "providerType": "local",
            "sourceRef": "paper.pdf",
        },
        mount={
            "directory": str(source_dir),
            "contentDir": "",
        },
        parse_docling=lambda node, source_path: [
            {
                "status": "ok",
                "chunkIndex": 0,
                "text": "docling result",
                "title": "paper",
                "source": {
                    "nodeId": node.node_id,
                    "name": node.name,
                    "path": source_path,
                },
            }
        ],
    )

    assert chunks[0]["text"] == "docling result"
    assert chunks[0]["source"]["path"] == str(source_file)


def test_prefers_content_dir_when_available(tmp_path: Path):
    source_dir = tmp_path / "source"
    content_dir = tmp_path / "content"
    source_dir.mkdir()
    content_dir.mkdir()
    (source_dir / "doc.txt").write_text("source version", encoding="utf-8")
    mirrored = content_dir / "doc.txt"
    mirrored.write_text("mirrored version", encoding="utf-8")

    chunks = parse_node(
        node={
            "nodeId": "node-3",
            "name": "doc.txt",
            "providerType": "local",
            "sourceRef": "doc.txt",
        },
        mount={
            "directory": str(source_dir),
            "contentDir": str(content_dir),
        },
    )

    assert chunks[0]["text"] == "mirrored version"
    assert chunks[0]["source"]["path"] == str(mirrored)


def test_returns_structured_error_for_unsupported_provider():
    chunks = parse_node(
        node={
            "nodeId": "node-4",
            "name": "remote.md",
            "providerType": "huggingface",
            "sourceRef": "remote.md",
        },
        mount={
            "directory": "/tmp/ignored",
            "contentDir": "",
        },
    )

    assert chunks == [
        {
            "status": "error",
            "chunkIndex": 0,
            "text": "",
            "title": "remote",
            "source": {
                "nodeId": "node-4",
                "name": "remote.md",
                "path": "",
            },
            "error": {
                "code": "UNSUPPORTED_PROVIDER",
                "message": "parser service only supports local provider nodes",
            },
        }
    ]
