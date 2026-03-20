from pathlib import Path

import pytest

from worker.parser.docling_adapter import default_docling_convert, parse_docling_document
from worker.runtime.logging import WorkerLogger


def test_docling_path_is_selected_for_pdf_like_inputs(tmp_path: Path):
    source_path = tmp_path / "paper.pdf"
    source_path.write_bytes(b"%PDF-1.7")

    calls: list[str] = []

    def convert(path: str):
        calls.append(path)
        return {
            "markdown": "# Parsed\n\nHello",
            "title": "Parsed",
        }

    chunks = parse_docling_document(
        node={"nodeId": "node-1", "name": "paper.pdf"},
        source_path=str(source_path),
        convert=convert,
    )

    assert calls == [str(source_path)]
    assert len(chunks) == 1
    assert chunks[0] == {
        "status": "ok",
        "chunkIndex": 0,
        "text": "# Parsed\n\nHello",
        "title": "Parsed",
        "source": {
            "nodeId": "node-1",
            "name": "paper.pdf",
            "path": str(source_path),
        },
    }


def test_docling_path_is_selected_for_docx_like_inputs(tmp_path: Path):
    source_path = tmp_path / "slides.docx"
    source_path.write_bytes(b"docx")

    chunks = parse_docling_document(
        node={"nodeId": "node-2", "name": "slides.docx"},
        source_path=str(source_path),
        convert=lambda path: {"markdown": "Docling output", "title": None},
    )

    assert chunks[0]["source"]["path"] == str(source_path)
    assert chunks[0]["text"] == "Docling output"


def test_docling_markdown_flows_through_shared_chunking(tmp_path: Path):
    source_path = tmp_path / "long.pdf"
    source_path.write_bytes(b"%PDF-1.7")

    chunks = parse_docling_document(
        node={"nodeId": "node-long", "name": "long.pdf"},
        source_path=str(source_path),
        convert=lambda path: {
            "markdown": (
                "# First\n\n"
                + ("Alpha sentence. " * 60)
                + "\n\n## Second\n\n"
                + ("Beta sentence. " * 60)
            ),
            "title": "Long Doc",
        },
    )

    assert len(chunks) == 2
    assert chunks[0]["text"].startswith("# First")
    assert chunks[1]["text"].startswith("## Second")
    assert all(chunk["title"] == "Long Doc" for chunk in chunks)


def test_docling_failures_surface_error_results(tmp_path: Path):
    source_path = tmp_path / "broken.pdf"
    source_path.write_bytes(b"%PDF-1.7")

    def fail(_: str):
        raise RuntimeError("boom")

    chunks = parse_docling_document(
        node={"nodeId": "node-3", "name": "broken.pdf"},
        source_path=str(source_path),
        convert=fail,
    )

    assert chunks == [
        {
            "status": "error",
            "chunkIndex": 0,
            "text": "",
            "title": "broken",
            "source": {
                "nodeId": "node-3",
                "name": "broken.pdf",
                "path": str(source_path),
            },
            "error": {
                "code": "DOCLING_PARSE_ERROR",
                "message": "boom",
            },
        }
    ]


def test_default_docling_convert_reuses_document_converter(monkeypatch: pytest.MonkeyPatch):
    instances: list[object] = []

    class FakeDocument:
        name = "Parsed"

        def export_to_markdown(self) -> str:
            return "# Parsed"

    class FakeResult:
        document = FakeDocument()

    class FakeDocumentConverter:
        def __init__(self) -> None:
            instances.append(self)

        def convert(self, _source_path: str) -> FakeResult:
            return FakeResult()

    monkeypatch.setattr(
        "docling.document_converter.DocumentConverter",
        FakeDocumentConverter,
    )

    first = default_docling_convert("/tmp/a.pdf")
    second = default_docling_convert("/tmp/b.pdf")

    assert first == {"markdown": "# Parsed", "title": "Parsed"}
    assert second == {"markdown": "# Parsed", "title": "Parsed"}
    assert len(instances) == 1


def test_docling_convert_logs_diagnostic_stages(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    source_path = tmp_path / "photo.png"
    source_path.write_bytes(b"\x89PNG\r\n\x1a\n")
    stderr = []

    class Buffer:
        def write(self, value: str) -> None:
            stderr.append(value)

        def flush(self) -> None:
            return None

    monkeypatch.setattr(
        "worker.parser.docling_adapter.get_process_rss_mb",
        lambda: 123,
    )

    chunks = parse_docling_document(
        node={"nodeId": "node-1", "name": "photo.png"},
        source_path=str(source_path),
        convert=lambda path: {"markdown": "image body", "title": "Photo"},
        logger=WorkerLogger(Buffer()),
    )

    joined = "".join(stderr)
    assert chunks[0]["text"] == "image body"
    assert '"msg":"docling convert started"' in joined
    assert '"msg":"docling convert finished"' in joined
    assert '"name":"photo.png"' in joined
    assert '"suffix":".png"' in joined
    assert '"rssMb":123' in joined
