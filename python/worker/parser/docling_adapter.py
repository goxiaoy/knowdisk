from __future__ import annotations

from functools import lru_cache
from time import perf_counter
from pathlib import Path
from collections.abc import Mapping
from typing import Callable

from worker.parser.markdown_chunker import chunk_markdown
from worker.parser.types import (
    ParsedChunk,
    ParsedChunkError,
    ParsedSource,
    ParserNode,
    coerce_parser_node,
)
from worker.runtime.logging import WorkerLogger, get_process_rss_mb

DoclingConvert = Callable[[str], Mapping[str, object]]


def parse_docling_document(
    node: ParserNode | Mapping[str, object],
    source_path: str,
    convert: DoclingConvert | None = None,
    logger: WorkerLogger | None = None,
) -> list[dict[str, object]]:
    parsed_node = coerce_parser_node(node)
    title = Path(parsed_node.name).stem
    suffix = Path(parsed_node.name).suffix.lower()
    size_bytes = Path(source_path).stat().st_size if Path(source_path).exists() else 0
    started_at = perf_counter()

    if logger is not None:
        logger.log(
            "debug",
            "docling convert started",
            name=parsed_node.name,
            suffix=suffix,
            sourcePath=source_path,
            sizeBytes=size_bytes,
            rssMb=get_process_rss_mb(),
        )

    try:
        result = (convert or default_docling_convert)(source_path)
    except Exception as error:
        if logger is not None:
            logger.log(
                "error",
                "docling convert failed",
                name=parsed_node.name,
                suffix=suffix,
                sourcePath=source_path,
                sizeBytes=size_bytes,
                durationMs=int((perf_counter() - started_at) * 1000),
                rssMb=get_process_rss_mb(),
                error=str(error),
            )
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
    if logger is not None:
        logger.log(
            "debug",
            "docling convert finished",
            name=parsed_node.name,
            suffix=suffix,
            sourcePath=source_path,
            sizeBytes=size_bytes,
            durationMs=int((perf_counter() - started_at) * 1000),
            rssMb=get_process_rss_mb(),
            markdownBytes=len(markdown.encode("utf-8")),
        )
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

    return chunk_markdown(
        node=parsed_node,
        markdown=markdown,
        title=str(result.get("title") or title),
        source_path=source_path,
    )


def default_docling_convert(source_path: str) -> dict[str, object]:
    result = _get_docling_converter().convert(source_path)
    return {
        "markdown": result.document.export_to_markdown(),
        "title": getattr(result.document, "name", None),
    }


@lru_cache(maxsize=1)
def _get_docling_converter():
    from docling.document_converter import DocumentConverter

    return DocumentConverter()
