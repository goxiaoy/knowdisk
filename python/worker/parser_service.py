from __future__ import annotations

from pathlib import Path
from collections.abc import Callable, Mapping

from worker.parser_docling import parse_docling_document
from worker.parser.types import (
    ParsedChunk,
    ParsedChunkError,
    ParsedSource,
    ParserMount,
    ParserNode,
    coerce_parsed_chunk,
    coerce_parser_mount,
    coerce_parser_node,
)
from worker.parser_simple import parse_simple_document


SimpleParser = Callable[[ParserNode, bytes], list[dict[str, object]]]
DoclingParser = Callable[[ParserNode, str], list[dict[str, object]]]

DOCLING_SUFFIXES = {".pdf", ".docx", ".pptx", ".xlsx"}


def parse_node(
    node: ParserNode | Mapping[str, object],
    mount: ParserMount | Mapping[str, object],
    parse_simple: SimpleParser = parse_simple_document,
    parse_docling: DoclingParser = parse_docling_document,
) -> list[dict[str, object]]:
    parsed_node = coerce_parser_node(node)
    parsed_mount = coerce_parser_mount(mount)
    provider_type = parsed_mount.provider_type or parsed_node.provider_type
    if provider_type != "local":
        return [
            ParsedChunk(
                status="error",
                chunk_index=0,
                text="",
                title=Path(parsed_node.name).stem,
                source=ParsedSource(
                    node_id=parsed_node.node_id,
                    name=parsed_node.name,
                ),
                error=ParsedChunkError(
                    code="UNSUPPORTED_PROVIDER",
                    message="parser service only supports local provider nodes",
                ),
            ).to_legacy_dict(include_empty_source_path=True)
        ]

    source_path = resolve_local_source_path(
        source_ref=parsed_node.source_ref,
        directory=parsed_mount.directory,
        content_dir=parsed_mount.content_dir,
    )
    suffix = Path(parsed_node.name).suffix.lower()

    if suffix in DOCLING_SUFFIXES:
        return parse_docling(parsed_node, str(source_path))

    content = source_path.read_bytes()
    chunks = parse_simple(parsed_node, content)
    return attach_source_path(chunks, str(source_path))


def resolve_local_source_path(source_ref: str, directory: str, content_dir: str) -> Path:
    relative_path = Path(source_ref)
    if content_dir:
        candidate = Path(content_dir) / relative_path
        if candidate.exists():
            return candidate
    return Path(directory) / relative_path


def attach_source_path(chunks: list[dict[str, object]], source_path: str) -> list[dict[str, object]]:
    attached: list[dict[str, object]] = []
    for chunk in chunks:
        parsed_chunk = coerce_parsed_chunk(chunk).with_source_path(source_path)
        attached.append(parsed_chunk.to_legacy_dict())
    return attached
