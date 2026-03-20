from pathlib import Path

from worker.parser.types import ParserMount, ParserNode
from worker.parser.service import parse_node


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
            "syncedContentPath": "",
            "localFilePath": str(source_file),
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
            synced_content_path="",
            local_file_path=str(source_file),
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
            "syncedContentPath": "",
            "localFilePath": str(source_file),
        },
        parse_docling=lambda node, source_path: [
            *[
                {
                    "status": "ok",
                    "chunkIndex": 0,
                    "text": "# First\n\n" + ("docling result. " * 60),
                    "title": "paper",
                    "source": {
                        "nodeId": node.node_id,
                        "name": node.name,
                        "path": source_path,
                    },
                },
                {
                    "status": "ok",
                    "chunkIndex": 1,
                    "text": "## Second\n\n" + ("follow up. " * 60),
                    "title": "paper",
                    "source": {
                        "nodeId": node.node_id,
                        "name": node.name,
                        "path": source_path,
                    },
                },
            ]
        ],
    )

    assert len(chunks) == 2
    assert chunks[0]["text"].startswith("# First")
    assert chunks[1]["text"].startswith("## Second")
    assert chunks[0]["source"]["path"] == str(source_file)


def test_selects_docling_for_png_local_node(tmp_path: Path):
    source_dir = tmp_path / "mount"
    source_dir.mkdir()
    source_file = source_dir / "photo.png"
    source_file.write_bytes(b"\x89PNG\r\n\x1a\n")

    chunks = parse_node(
        node={
            "nodeId": "node-image-1",
            "name": "photo.png",
            "providerType": "local",
            "sourceRef": "photo.png",
        },
        mount={
            "syncedContentPath": "",
            "localFilePath": str(source_file),
        },
        parse_docling=lambda node, source_path: [
            {
                "status": "ok",
                "chunkIndex": 0,
                "text": "image docling result",
                "title": "photo",
                "source": {
                    "nodeId": node.node_id,
                    "name": node.name,
                    "path": source_path,
                },
            }
        ],
    )

    assert chunks[0]["text"] == "image docling result"
    assert chunks[0]["source"]["path"] == str(source_file)


def test_selects_docling_for_html_local_node(tmp_path: Path):
    source_dir = tmp_path / "mount"
    source_dir.mkdir()
    source_file = source_dir / "page.html"
    source_file.write_text("<html><body>Hello</body></html>", encoding="utf-8")

    chunks = parse_node(
        node={
            "nodeId": "node-html-1",
            "name": "page.html",
            "providerType": "local",
            "sourceRef": "page.html",
        },
        mount={
            "syncedContentPath": "",
            "localFilePath": str(source_file),
        },
        parse_docling=lambda node, source_path: [
            {
                "status": "ok",
                "chunkIndex": 0,
                "text": "html docling result",
                "title": "page",
                "source": {
                    "nodeId": node.node_id,
                    "name": node.name,
                    "path": source_path,
                },
            }
        ],
    )

    assert chunks[0]["text"] == "html docling result"
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
            "syncedContentPath": str(mirrored),
            "localFilePath": str(source_dir / "doc.txt"),
        },
    )

    assert chunks[0]["text"] == "mirrored version"
    assert chunks[0]["source"]["path"] == str(mirrored)


def test_selects_simple_parser_for_json_local_node(tmp_path: Path):
    source_dir = tmp_path / "mount"
    source_dir.mkdir()
    source_file = source_dir / "data.json"
    source_file.write_text('{"hello":"world"}', encoding="utf-8")

    calls: list[tuple[str, bytes]] = []

    def fake_simple(node: ParserNode, content: bytes) -> list[dict[str, object]]:
        calls.append((node.name, content))
        return [
            {
                "status": "ok",
                "chunkIndex": 0,
                "text": content.decode("utf-8"),
                "title": "data",
                "source": {
                    "nodeId": node.node_id,
                    "name": node.name,
                    "path": "",
                },
            }
        ]

    chunks = parse_node(
        node={
            "nodeId": "node-json-1",
            "name": "data.json",
            "providerType": "local",
            "sourceRef": "data.json",
        },
        mount={
            "syncedContentPath": "",
            "localFilePath": str(source_file),
        },
        parse_simple=fake_simple,
    )

    assert calls == [("data.json", b'{"hello":"world"}')]
    assert chunks[0]["status"] == "ok"
    assert chunks[0]["text"] == '{"hello":"world"}'
    assert chunks[0]["source"]["path"] == str(source_file)


def test_skips_unsupported_local_file_suffix(tmp_path: Path):
    source_dir = tmp_path / "mount"
    source_dir.mkdir()
    source_file = source_dir / "clip.mkv"
    source_file.write_bytes(b"not-a-real-video")

    chunks = parse_node(
        node={
            "nodeId": "node-video-1",
            "name": "clip.mkv",
            "providerType": "local",
            "sourceRef": "clip.mkv",
        },
        mount={
            "syncedContentPath": "",
            "localFilePath": str(source_file),
        },
    )

    assert chunks == [
        {
            "status": "skipped",
            "chunkIndex": 0,
            "text": "",
            "title": "clip",
            "source": {
                "nodeId": "node-video-1",
                "name": "clip.mkv",
                "path": str(source_file),
            },
            "error": {
                "code": "UNSUPPORTED_FILE_TYPE",
                "message": "parser whitelist does not support file suffix .mkv",
            },
        }
    ]


def test_returns_structured_error_for_unsupported_provider():
    chunks = parse_node(
        node={
            "nodeId": "node-4",
            "name": "remote.md",
            "providerType": "huggingface",
            "sourceRef": "remote.md",
        },
        mount={
            "syncedContentPath": "",
            "localFilePath": "/tmp/ignored/remote.md",
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
