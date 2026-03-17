from pathlib import Path

from worker.parser_docling import parse_docling_document


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
    assert chunks == [
        {
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
    ]


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
