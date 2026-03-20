from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path

from worker.parser.types import (
    ParsedChunk,
    ParsedChunkError,
    ParsedSource,
    ParserNode,
    coerce_parser_node,
)


def parse_simple_document(
    node: ParserNode | Mapping[str, object],
    content: bytes,
) -> list[dict[str, object]]:
    parsed_node = coerce_parser_node(node)
    title = Path(parsed_node.name).stem
    text = normalize_simple_content(name=parsed_node.name, content=content)
    source = ParsedSource(
        node_id=parsed_node.node_id,
        name=parsed_node.name,
    )

    if not text.strip():
        return [
            ParsedChunk(
                status="skipped",
                chunk_index=0,
                text="",
                title=title,
                source=source,
                error=ParsedChunkError(
                    code="EMPTY_CONTENT",
                    message="simple parser content is empty",
                ),
            ).to_legacy_dict()
        ]

    return [
        ParsedChunk(
            status="ok",
            chunk_index=0,
            text=text,
            title=title,
            source=source,
        ).to_legacy_dict()
    ]


def normalize_simple_content(name: str, content: bytes) -> str:
    suffix = Path(name).suffix.lower()
    decoded = content.decode("utf-8", errors="ignore")

    if suffix == ".json":
        parsed = json.loads(decoded or "{}")
        return json.dumps(parsed, ensure_ascii=True, indent=2, sort_keys=True)

    return decoded.strip()
