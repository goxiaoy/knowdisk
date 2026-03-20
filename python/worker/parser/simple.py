from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path

from worker.parser.markdown_chunker import chunk_markdown
from worker.parser.types import (
    ParserNode,
    coerce_parser_node,
)


def parse_simple_document(
    node: ParserNode | Mapping[str, object],
    content: bytes,
) -> list[dict[str, object]]:
    parsed_node = coerce_parser_node(node)
    title = Path(parsed_node.name).stem
    markdown = normalize_simple_content(name=parsed_node.name, content=content)

    if not markdown.strip():
        from worker.parser.types import ParsedChunk, ParsedChunkError, ParsedSource

        return [
            ParsedChunk(
                status="skipped",
                chunk_index=0,
                text="",
                title=title,
                source=ParsedSource(
                    node_id=parsed_node.node_id,
                    name=parsed_node.name,
                ),
                error=ParsedChunkError(
                    code="EMPTY_CONTENT",
                    message="simple parser content is empty",
                ),
            ).to_legacy_dict()
        ]

    return chunk_markdown(
        node=parsed_node,
        markdown=markdown,
        title=title,
        use_ast=is_markdown_document(parsed_node.name),
    )


def normalize_simple_content(name: str, content: bytes) -> str:
    suffix = Path(name).suffix.lower()
    decoded = content.decode("utf-8", errors="ignore")

    if suffix == ".json":
        parsed = json.loads(decoded or "{}")
        return json.dumps(parsed, ensure_ascii=True, indent=2, sort_keys=True)

    return decoded.strip()


def is_markdown_document(name: str) -> bool:
    return Path(name).suffix.lower() in {".md", ".mdx", ".markdown"}
