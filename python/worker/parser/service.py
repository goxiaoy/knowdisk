from __future__ import annotations

from pathlib import Path
from collections.abc import Callable, Mapping
from inspect import Parameter, signature

from docling.datamodel.base_models import FormatToExtensions, InputFormat
from worker.parser.docling_adapter import parse_docling_document
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
from worker.parser.simple import parse_simple_document
from worker.runtime.logging import WorkerLogger


SimpleParser = Callable[[ParserNode, bytes], list[dict[str, object]]]
DoclingParser = Callable[[ParserNode, str], list[dict[str, object]]]

DOCLING_FORMATS = (
    InputFormat.PDF,
    InputFormat.DOCX,
    InputFormat.PPTX,
    InputFormat.XLSX,
    InputFormat.HTML,
    InputFormat.IMAGE,
    InputFormat.ASCIIDOC,
    InputFormat.CSV,
    InputFormat.VTT,
    InputFormat.LATEX,
)
DOCLING_SUFFIXES = {
    f".{extension.lower()}"
    for format_name in DOCLING_FORMATS
    for extension in FormatToExtensions[format_name]
}
SIMPLE_SUFFIXES = {
    ".c",
    ".cc",
    ".conf",
    ".cpp",
    ".css",
    ".csv",
    ".go",
    ".h",
    ".hpp",
    ".htm",
    ".html",
    ".ini",
    ".java",
    ".js",
    ".json",
    ".jsonl",
    ".jsx",
    ".log",
    ".md",
    ".mdx",
    ".py",
    ".rb",
    ".rs",
    ".scss",
    ".sh",
    ".sql",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}


def parse_node(
    node: ParserNode | Mapping[str, object],
    mount: ParserMount | Mapping[str, object],
    parse_simple: SimpleParser = parse_simple_document,
    parse_docling: DoclingParser = parse_docling_document,
    *,
    logger: WorkerLogger | None = None,
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
        synced_content_path=parsed_mount.synced_content_path,
        local_file_path=parsed_mount.local_file_path,
    )
    suffix = Path(parsed_node.name).suffix.lower()

    if is_docling_suffix(suffix):
        parameters = signature(parse_docling).parameters.values()
        supports_logger = any(
            parameter.kind == Parameter.VAR_KEYWORD or parameter.name == "logger"
            for parameter in parameters
        )
        if supports_logger:
            return parse_docling(parsed_node, str(source_path), logger=logger)
        return parse_docling(parsed_node, str(source_path))

    if not is_simple_suffix(suffix):
        return [
            ParsedChunk(
                status="skipped",
                chunk_index=0,
                text="",
                title=Path(parsed_node.name).stem,
                source=ParsedSource(
                    node_id=parsed_node.node_id,
                    name=parsed_node.name,
                    path=str(source_path),
                ),
                error=ParsedChunkError(
                    code="UNSUPPORTED_FILE_TYPE",
                    message=f"parser whitelist does not support file suffix {suffix or '<none>'}",
                ),
            ).to_legacy_dict()
        ]

    content = source_path.read_bytes()
    chunks = parse_simple(parsed_node, content)
    return attach_source_path(chunks, str(source_path))


def is_docling_suffix(suffix: str) -> bool:
    return suffix.lower() in DOCLING_SUFFIXES


def is_simple_suffix(suffix: str) -> bool:
    return suffix.lower() in SIMPLE_SUFFIXES


def resolve_local_source_path(synced_content_path: str, local_file_path: str) -> Path:
    if synced_content_path:
        candidate = Path(synced_content_path)
        if candidate.exists():
            return candidate
    return Path(local_file_path)


def attach_source_path(chunks: list[dict[str, object]], source_path: str) -> list[dict[str, object]]:
    attached: list[dict[str, object]] = []
    for chunk in chunks:
        parsed_chunk = coerce_parsed_chunk(chunk).with_source_path(source_path)
        attached.append(parsed_chunk.to_legacy_dict())
    return attached
