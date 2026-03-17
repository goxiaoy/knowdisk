from __future__ import annotations

from pathlib import Path
from typing import Any, Callable


DoclingConvert = Callable[[str], dict[str, Any]]


def parse_docling_document(
    node: dict[str, Any],
    source_path: str,
    convert: DoclingConvert | None = None,
) -> list[dict[str, Any]]:
    title = Path(str(node["name"])).stem

    try:
        result = (convert or default_docling_convert)(source_path)
    except Exception as error:
        return [
            {
                "status": "error",
                "chunkIndex": 0,
                "text": "",
                "title": title,
                "source": {
                    "nodeId": node["nodeId"],
                    "name": node["name"],
                    "path": source_path,
                },
                "error": {
                    "code": "DOCLING_PARSE_ERROR",
                    "message": str(error),
                },
            }
        ]

    markdown = str(result.get("markdown", "")).strip()
    if not markdown:
        return [
            {
                "status": "skipped",
                "chunkIndex": 0,
                "text": "",
                "title": str(result.get("title") or title),
                "source": {
                    "nodeId": node["nodeId"],
                    "name": node["name"],
                    "path": source_path,
                },
                "error": {
                    "code": "EMPTY_DOCLING_MARKDOWN",
                    "message": "docling output is empty",
                },
            }
        ]

    return [
        {
            "status": "ok",
            "chunkIndex": 0,
            "text": markdown,
            "title": str(result.get("title") or title),
            "source": {
                "nodeId": node["nodeId"],
                "name": node["name"],
                "path": source_path,
            },
        }
    ]


def default_docling_convert(source_path: str) -> dict[str, Any]:
    from docling.document_converter import DocumentConverter

    converter = DocumentConverter()
    result = converter.convert(source_path)
    return {
        "markdown": result.document.export_to_markdown(),
        "title": getattr(result.document, "name", None),
    }
