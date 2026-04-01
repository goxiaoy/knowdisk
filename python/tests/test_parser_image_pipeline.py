from io import StringIO
from pathlib import Path

from worker.parser.image_pipeline import parse_image_document
from worker.parser.types import ParserNode
from worker.runtime.logging import create_worker_logger


def test_parse_image_document_builds_single_multimodal_chunk(tmp_path: Path):
    source_file = tmp_path / "photo.png"
    source_file.write_bytes(b"\x89PNG\r\n\x1a\n")

    ocr_calls: list[tuple[object, str]] = []
    caption_calls: list[tuple[object, str]] = []

    def fake_ocr(runtime: object, source_path: str) -> dict[str, object]:
        ocr_calls.append((runtime, source_path))
        return {
            "text": "Detected text",
            "page": 7,
            "regions": [
                {"id": "r1", "bbox": [1, 2, 3, 4], "text": "logo"},
            ],
        }

    def fake_caption(runtime: object, source_path: str) -> dict[str, object]:
        caption_calls.append((runtime, source_path))
        return {"caption": "A cat on a chair"}

    chunks = parse_image_document(
        ParserNode(
            node_id="node-image-1",
            name="photo.png",
            source_ref="photo.png",
            provider_type="local",
        ),
        str(source_file),
        ocr_runtime={"runtime": "ocr"},
        caption_runtime={"runtime": "caption"},
        ocr_analyze=fake_ocr,
        caption_analyze=fake_caption,
    )

    assert ocr_calls == [({"runtime": "ocr"}, str(source_file))]
    assert caption_calls == [({"runtime": "caption"}, str(source_file))]
    assert len(chunks) == 1
    assert chunks[0]["status"] == "ok"
    assert chunks[0]["chunkIndex"] == 0
    assert chunks[0]["source"]["path"] == str(source_file)
    assert "Image caption:" in chunks[0]["text"]
    assert "A cat on a chair" in chunks[0]["text"]
    assert "Image OCR:" in chunks[0]["text"]
    assert "```text\nDetected text\n```" in chunks[0]["text"]
    assert "Image metadata:" in chunks[0]["text"]
    assert "```text\npath=" in chunks[0]["text"]
    assert "page=7" in chunks[0]["text"]
    assert "regions=1" in chunks[0]["text"]


def test_parse_image_document_returns_error_chunk_when_ocr_fails(tmp_path: Path):
    source_file = tmp_path / "photo.png"
    source_file.write_bytes(b"\x89PNG\r\n\x1a\n")

    caption_called = False

    def fake_ocr(runtime: object, source_path: str) -> dict[str, object]:
        _ = runtime, source_path
        raise RuntimeError("ocr boom")

    def fake_caption(runtime: object, source_path: str) -> dict[str, object]:
        nonlocal caption_called
        caption_called = True
        _ = runtime, source_path
        return {"caption": "ignored"}

    chunks = parse_image_document(
        ParserNode(
            node_id="node-image-2",
            name="photo.png",
            source_ref="photo.png",
            provider_type="local",
        ),
        str(source_file),
        ocr_runtime={"runtime": "ocr"},
        caption_runtime={"runtime": "caption"},
        ocr_analyze=fake_ocr,
        caption_analyze=fake_caption,
    )

    assert caption_called is False
    assert chunks == [
        {
            "status": "error",
            "chunkIndex": 0,
            "text": "",
            "title": "photo",
            "source": {
                "nodeId": "node-image-2",
                "name": "photo.png",
                "path": str(source_file),
            },
            "error": {
                "code": "IMAGE_OCR_ERROR",
                "message": "ocr boom",
            },
        }
    ]


def test_parse_image_document_returns_error_chunk_when_caption_fails(tmp_path: Path):
    source_file = tmp_path / "photo.png"
    source_file.write_bytes(b"\x89PNG\r\n\x1a\n")

    ocr_called = False

    def fake_ocr(runtime: object, source_path: str) -> dict[str, object]:
        nonlocal ocr_called
        ocr_called = True
        _ = runtime, source_path
        return {"text": "Detected text", "regions": []}

    def fake_caption(runtime: object, source_path: str) -> dict[str, object]:
        _ = runtime, source_path
        raise RuntimeError("caption boom")

    chunks = parse_image_document(
        ParserNode(
            node_id="node-image-3",
            name="photo.png",
            source_ref="photo.png",
            provider_type="local",
        ),
        str(source_file),
        ocr_runtime={"runtime": "ocr"},
        caption_runtime={"runtime": "caption"},
        ocr_analyze=fake_ocr,
        caption_analyze=fake_caption,
    )

    assert ocr_called is True
    assert chunks == [
        {
            "status": "error",
            "chunkIndex": 0,
            "text": "",
            "title": "photo",
            "source": {
                "nodeId": "node-image-3",
                "name": "photo.png",
                "path": str(source_file),
            },
            "error": {
                "code": "IMAGE_CAPTION_ERROR",
                "message": "caption boom",
            },
        }
    ]


def test_parse_image_document_logs_ocr_debug_summary(tmp_path: Path):
    source_file = tmp_path / "photo.png"
    source_file.write_bytes(b"\x89PNG\r\n\x1a\n")
    logger_stream = StringIO()

    def fake_ocr(runtime: object, source_path: str) -> dict[str, object]:
        _ = runtime, source_path
        return {
            "text": "Detected text",
            "regions": [{"id": "r1", "text": "Alpha"}],
            "debug": {
                "ocrPayloadKeys": ["rec_boxes", "rec_texts", "textline_orientation_angles"],
                "layoutPayloadKeys": ["layout"],
                "ocrPreviewTexts": ["Alpha", "Seller Block"],
                "layoutPreviewTexts": ["Document Title"],
            },
        }

    def fake_caption(runtime: object, source_path: str) -> dict[str, object]:
        _ = runtime, source_path
        return {"caption": ""}

    parse_image_document(
        ParserNode(
            node_id="node-image-4",
            name="photo.png",
            source_ref="photo.png",
            provider_type="local",
        ),
        str(source_file),
        ocr_runtime={"runtime": "ocr"},
        caption_runtime={"runtime": "caption"},
        ocr_analyze=fake_ocr,
        caption_analyze=fake_caption,
        logger=create_worker_logger(logger_stream),
    )

    output = logger_stream.getvalue()
    assert '"msg":"image ocr debug"' in output
    assert '"ocrPayloadKeys":["rec_boxes","rec_texts","textline_orientation_angles"]' in output
    assert '"ocrPreviewTexts":["Alpha","Seller Block"]' in output
