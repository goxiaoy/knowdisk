from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from worker.parser_docling import parse_docling_document
from worker.parser_simple import parse_simple_document


SimpleParser = Callable[[dict[str, Any], bytes], list[dict[str, Any]]]
DoclingParser = Callable[[dict[str, Any], str], list[dict[str, Any]]]

DOCLING_SUFFIXES = {".pdf", ".docx", ".pptx", ".xlsx"}


def parse_node(
    node: dict[str, Any],
    mount: dict[str, Any],
    parse_simple: SimpleParser = parse_simple_document,
    parse_docling: DoclingParser = parse_docling_document,
) -> list[dict[str, Any]]:
    if node.get("providerType") != "local":
        return [
            {
                "status": "error",
                "chunkIndex": 0,
                "text": "",
                "title": Path(str(node["name"])).stem,
                "source": {
                    "nodeId": node["nodeId"],
                    "name": node["name"],
                    "path": "",
                },
                "error": {
                    "code": "UNSUPPORTED_PROVIDER",
                    "message": "parser service only supports local provider nodes",
                },
            }
        ]

    source_path = resolve_local_source_path(
        source_ref=str(node["sourceRef"]),
        directory=str(mount.get("directory") or ""),
        content_dir=str(mount.get("contentDir") or ""),
    )
    suffix = Path(str(node["name"])).suffix.lower()

    if suffix in DOCLING_SUFFIXES:
        return parse_docling(node, str(source_path))

    content = source_path.read_bytes()
    chunks = parse_simple(node, content)
    return attach_source_path(chunks, str(source_path))


def resolve_local_source_path(source_ref: str, directory: str, content_dir: str) -> Path:
    relative_path = Path(source_ref)
    if content_dir:
        candidate = Path(content_dir) / relative_path
        if candidate.exists():
            return candidate
    return Path(directory) / relative_path


def attach_source_path(chunks: list[dict[str, Any]], source_path: str) -> list[dict[str, Any]]:
    attached: list[dict[str, Any]] = []
    for chunk in chunks:
        next_chunk = dict(chunk)
        next_chunk["source"] = {
            **chunk["source"],
            "path": source_path,
        }
        attached.append(next_chunk)
    return attached
