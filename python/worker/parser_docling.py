from __future__ import annotations

from pathlib import Path
from collections.abc import Mapping
from typing import Callable

from worker.parser.types import (
    ParsedChunk,
    ParsedChunkError,
    ParsedSource,
    ParserNode,
    coerce_parser_node,
)

DoclingConvert = Callable[[str], Mapping[str, object]]


def parse_docling_document(
    node: ParserNode | Mapping[str, object],
    source_path: str,
    convert: DoclingConvert | None = None,
) -> list[dict[str, object]]:
    parsed_node = coerce_parser_node(node)
    title = Path(parsed_node.name).stem

    try:
        result = (convert or default_docling_convert)(source_path)
    except Exception as error:
        return [
            ParsedChunk(
                status="error",
                chunk_index=0,
                text="",
                title=title,
                source=ParsedSource(
                    node_id=parsed_node.node_id,
                    name=parsed_node.name,
                    path=source_path,
                ),
                error=ParsedChunkError(
                    code="DOCLING_PARSE_ERROR",
                    message=str(error),
                ),
            ).to_legacy_dict()
        ]

    markdown = str(result.get("markdown", "")).strip()
    if not markdown:
        return [
            ParsedChunk(
                status="skipped",
                chunk_index=0,
                text="",
                title=str(result.get("title") or title),
                source=ParsedSource(
                    node_id=parsed_node.node_id,
                    name=parsed_node.name,
                    path=source_path,
                ),
                error=ParsedChunkError(
                    code="EMPTY_DOCLING_MARKDOWN",
                    message="docling output is empty",
                ),
            ).to_legacy_dict()
        ]

    return [
        ParsedChunk(
            status="ok",
            chunk_index=0,
            text=markdown,
            title=str(result.get("title") or title),
            source=ParsedSource(
                node_id=parsed_node.node_id,
                name=parsed_node.name,
                path=source_path,
            ),
        ).to_legacy_dict()
    ]


def default_docling_convert(source_path: str) -> dict[str, object]:
    from docling.document_converter import DocumentConverter

    converter = DocumentConverter()
    result = converter.convert(source_path)
    return {
        "markdown": result.document.export_to_markdown(),
        "title": getattr(result.document, "name", None),
    }
