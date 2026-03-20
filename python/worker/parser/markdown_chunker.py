from __future__ import annotations

import re
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from functools import lru_cache

import mistune

from worker.parser.types import ParsedChunk, ParsedSource, ParserNode, coerce_parser_node

MIN_CHUNK_CHARS = 400
TARGET_CHUNK_CHARS = 1200
MAX_CHUNK_CHARS = 1800
HARD_SPLIT_CHARS = 2200

SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[.!?])\s+")


@dataclass(frozen=True, slots=True)
class MarkdownBlock:
    text: str
    kind: str


@dataclass(frozen=True, slots=True)
class MarkdownSection:
    blocks: tuple[MarkdownBlock, ...]


def chunk_markdown(
    *,
    node: ParserNode | Mapping[str, object],
    markdown: str,
    title: str,
    source_path: str = "",
    use_ast: bool = True,
) -> list[dict[str, object]]:
    parsed_node = coerce_parser_node(node)
    sections = (
        iter_sections(iter_markdown_blocks(markdown))
        if use_ast
        else iter_plain_text_sections(markdown)
    )
    chunk_texts = list(iter_chunk_texts(sections))
    source = ParsedSource(
        node_id=parsed_node.node_id,
        name=parsed_node.name,
        path=source_path,
    )
    return [
        ParsedChunk(
            status="ok",
            chunk_index=index,
            text=text,
            title=title,
            source=source,
        ).to_legacy_dict(include_empty_source_path=bool(source_path))
        for index, text in enumerate(chunk_texts)
        if text.strip()
    ]


def iter_markdown_blocks(markdown: str) -> Iterator[MarkdownBlock]:
    normalized = markdown.replace("\r\n", "\n").strip()
    if not normalized:
        return

    for node in _get_markdown_parser()(normalized):
        block = _ast_node_to_block(node)
        if block is None or not block.text.strip():
            continue
        yield block


def iter_sections(blocks: Iterator[MarkdownBlock]) -> Iterator[MarkdownSection]:
    current: list[MarkdownBlock] = []
    for block in blocks:
        if block.kind == "heading" and current:
            yield MarkdownSection(blocks=tuple(current))
            current = [block]
            continue
        current.append(block)
    if current:
        yield MarkdownSection(blocks=tuple(current))


def iter_plain_text_sections(text: str) -> Iterator[MarkdownSection]:
    normalized = text.strip()
    if not normalized:
        return
    yield MarkdownSection(blocks=(MarkdownBlock(text=normalized, kind="paragraph"),))


def iter_chunk_texts(sections: Iterator[MarkdownSection]) -> Iterator[str]:
    for section in sections:
        for chunk in _chunk_section(section):
            yield chunk


def _chunk_section(section: MarkdownSection) -> list[str]:
    provisional: list[MarkdownBlock] = []
    current_parts: list[MarkdownBlock] = []

    for block in section.blocks:
        if not current_parts:
            current_parts = [block]
            continue

        proposed = _join_block_texts((*current_parts, block))
        current_text = _join_block_texts(current_parts)
        if len(proposed) <= TARGET_CHUNK_CHARS or len(current_text) < MIN_CHUNK_CHARS:
            current_parts.append(block)
            continue

        oversized_text = proposed if len(current_text) < MIN_CHUNK_CHARS else block.text
        if len(oversized_text) > MAX_CHUNK_CHARS:
            if oversized_text == block.text:
                provisional.append(MarkdownBlock(text=current_text, kind="mixed"))
            provisional.extend(_split_oversized_block(block if oversized_text == block.text else MarkdownBlock(text=oversized_text, kind="mixed")))
            current_parts = []
            continue

        provisional.append(MarkdownBlock(text=current_text, kind="mixed"))
        current_parts = [block]

    if current_parts:
        assembled = MarkdownBlock(text=_join_block_texts(current_parts), kind="mixed")
        if len(assembled.text) > MAX_CHUNK_CHARS:
            provisional.extend(_split_oversized_block(assembled))
        else:
            provisional.append(assembled)

    return _merge_short_chunks_forward(provisional)


def _merge_short_chunks_forward(chunks: list[MarkdownBlock]) -> list[str]:
    merged: list[str] = []
    index = 0
    while index < len(chunks):
        current = chunks[index].text.strip()
        if not current:
            index += 1
            continue
        if len(current) < MIN_CHUNK_CHARS and index + 1 < len(chunks):
            merged.append(_join_texts((current, chunks[index + 1].text.strip())))
            index += 2
            continue
        merged.append(current)
        index += 1
    return merged


def _split_oversized_block(block: MarkdownBlock) -> list[MarkdownBlock]:
    if block.kind == "code":
        return [block]

    sentences = [part.strip() for part in SENTENCE_BOUNDARY_RE.split(block.text.strip()) if part.strip()]
    if len(sentences) <= 1:
        return [MarkdownBlock(text=part, kind=block.kind) for part in _hard_split_text(block.text)]

    out: list[MarkdownBlock] = []
    current = ""
    for sentence in sentences:
        proposed = sentence if not current else f"{current} {sentence}"
        if len(proposed) <= TARGET_CHUNK_CHARS:
            current = proposed
            continue
        if current:
            out.append(MarkdownBlock(text=current.strip(), kind=block.kind))
        if len(sentence) > HARD_SPLIT_CHARS:
            out.extend(MarkdownBlock(text=part, kind=block.kind) for part in _hard_split_text(sentence))
            current = ""
            continue
        current = sentence
    if current:
        out.append(MarkdownBlock(text=current.strip(), kind=block.kind))
    return out


def _hard_split_text(text: str) -> list[str]:
    stripped = text.strip()
    return [
        stripped[index : index + HARD_SPLIT_CHARS].strip()
        for index in range(0, len(stripped), HARD_SPLIT_CHARS)
        if stripped[index : index + HARD_SPLIT_CHARS].strip()
    ]


def _join_block_texts(parts: tuple[MarkdownBlock, ...] | list[MarkdownBlock]) -> str:
    return _join_texts(tuple(part.text for part in parts))


def _join_texts(parts: tuple[str, ...] | list[str]) -> str:
    return "\n\n".join(part.strip() for part in parts if part.strip()).strip()


def _ast_node_to_block(node: Mapping[str, object]) -> MarkdownBlock | None:
    node_type = str(node.get("type") or "")
    if node_type == "blank_line":
        return None
    if node_type == "heading":
        level = int((node.get("attrs") or {}).get("level", 1))  # type: ignore[union-attr]
        text = _render_inline_children(node.get("children"))
        return MarkdownBlock(text=f'{"#" * level} {text}'.strip(), kind="heading")
    if node_type == "paragraph":
        return MarkdownBlock(text=_render_inline_children(node.get("children")), kind="paragraph")
    if node_type == "block_code":
        info = str((node.get("attrs") or {}).get("info") or "")  # type: ignore[union-attr]
        raw = str(node.get("raw") or "").rstrip("\n")
        fence = f"```{info}".rstrip()
        return MarkdownBlock(text=f"{fence}\n{raw}\n```", kind="code")
    if node_type == "block_quote":
        body = _render_block_children(node.get("children"))
        quoted = "\n".join(f"> {line}" if line else ">" for line in body.split("\n"))
        return MarkdownBlock(text=quoted.strip(), kind="blockquote")
    if node_type == "list":
        return MarkdownBlock(text=_render_list(node), kind="list")
    return MarkdownBlock(text=_render_fallback(node), kind="paragraph")


def _render_list(node: Mapping[str, object]) -> str:
    attrs = node.get("attrs") or {}
    ordered = bool(attrs.get("ordered")) if isinstance(attrs, Mapping) else False
    items = []
    for index, item in enumerate(_as_node_list(node.get("children")), start=1):
        marker = f"{index}." if ordered else "-"
        item_text = _render_list_item(item).strip()
        lines = item_text.split("\n")
        items.append("\n".join([f"{marker} {lines[0]}"] + [f"  {line}" for line in lines[1:]]))
    return "\n".join(items).strip()


def _render_list_item(node: Mapping[str, object]) -> str:
    parts = []
    for child in _as_node_list(node.get("children")):
        child_type = str(child.get("type") or "")
        if child_type == "block_text":
            parts.append(_render_inline_children(child.get("children")))
        else:
            parts.append(_render_fallback(child))
    return "\n".join(part for part in parts if part.strip())


def _render_block_children(children: object) -> str:
    parts = []
    for child in _as_node_list(children):
        block = _ast_node_to_block(child)
        if block is not None and block.text.strip():
            parts.append(block.text.strip())
    return "\n\n".join(parts).strip()


def _render_inline_children(children: object) -> str:
    parts = []
    for child in _as_node_list(children):
        parts.append(_render_inline_node(child))
    return "".join(parts).strip()


def _render_inline_node(node: Mapping[str, object]) -> str:
    node_type = str(node.get("type") or "")
    if node_type == "text":
        return str(node.get("raw") or "")
    if node_type == "softbreak":
        return "\n"
    if node_type == "linebreak":
        return "\n"
    if node_type == "codespan":
        return f'`{str(node.get("raw") or "")}`'
    if node_type == "emphasis":
        return f"*{_render_inline_children(node.get('children'))}*"
    if node_type == "strong":
        return f"**{_render_inline_children(node.get('children'))}**"
    if node_type == "link":
        return f"[{_render_inline_children(node.get('children'))}]({str((node.get('attrs') or {}).get('url') or '')})"
    if node_type == "image":
        attrs = node.get("attrs") or {}
        url = str(attrs.get("url") or "") if isinstance(attrs, Mapping) else ""
        return f"![{_render_inline_children(node.get('children'))}]({url})"
    if node_type == "inline_html":
        return str(node.get("raw") or "")
    return _render_inline_children(node.get("children"))


def _render_fallback(node: Mapping[str, object]) -> str:
    raw = str(node.get("raw") or "").strip()
    if raw:
        return raw
    return _render_inline_children(node.get("children"))


def _as_node_list(value: object) -> list[Mapping[str, object]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, Mapping)]


@lru_cache(maxsize=1)
def _get_markdown_parser():
    return mistune.create_markdown(renderer="ast")
