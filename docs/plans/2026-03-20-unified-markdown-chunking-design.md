# Unified Markdown Chunking Design

## Goal

Make both simple-parser and docling-parser outputs flow through one markdown chunking path before embedding so large markdown files no longer become one oversized embedding request.

## Context

Today the Python parser stack produces `ParsedChunk[]` directly:

- `simple.py` returns a single `ok` chunk for non-empty normalized text.
- `docling_adapter.py` returns a single `ok` chunk containing converted markdown.
- `index/service.py` embeds every `ok` chunk as-is.

That behavior means a long markdown document can become exactly one embedding row. The observed log for `19-Chapter-13-Human-in-the-Loop.md` showed `rowCount=1` and `durationMs=18563`, which is consistent with one large chunk flowing into the embedding stage.

## Decision

Unify both parser branches behind a markdown-first pipeline:

`simple/docling -> markdown -> markdown chunker -> ParsedChunk[] -> embedding`

The chunker will process markdown incrementally via generators/iterators rather than building multiple large intermediate lists. The first implementation will still accept a markdown string from the parser adapters, but the chunking algorithm itself will be streaming-oriented.

## Requirements

- Use one chunking algorithm for markdown emitted by both simple and docling paths.
- Preserve section semantics by honoring markdown headings.
- Do not overlap across sections.
- Within a section, aggregate by markdown blocks rather than raw line windows.
- Merge very short blocks forward within the same section.
- Split oversized chunks by sentence boundaries first, then by hard character boundaries if needed.
- Keep code fences, tables, block quotes, and list groups intact unless they exceed the hard split threshold.
- Keep current error and skipped semantics intact.

## Proposed Architecture

### 1. Parser service becomes a router

`python/worker/parser/service.py` continues deciding which source types are supported and whether the source should use the simple or docling adapter. It stops treating either adapter as the final chunk producer.

Instead:

- simple-supported files produce normalized markdown text.
- docling-supported files produce converted markdown text.
- unsupported files still return a structured `skipped` result.
- provider errors still return `error`.

### 2. Introduce a markdown chunker module

Create `python/worker/parser/markdown_chunker.py` with two responsibilities:

- parse markdown into section/block events
- assemble those events into bounded chunks

Recommended public API:

```python
def chunk_markdown(
    *,
    node: ParserNode,
    markdown: str,
    title: str,
    source_path: str = "",
) -> list[dict[str, object]]:
    ...
```

Internal helpers:

- `iter_markdown_blocks(markdown: str) -> Iterator[MarkdownBlock]`
- `iter_sections(blocks: Iterator[MarkdownBlock]) -> Iterator[MarkdownSection]`
- `iter_chunk_texts(section: MarkdownSection) -> Iterator[str]`

This keeps the interface simple for callers while preserving a streaming internal shape.

### 3. Simple parser returns markdown, not final chunks

`python/worker/parser/simple.py` should be split into:

- normalization: decode input and normalize markdown/text/json into markdown text
- chunking: hand the markdown text to the shared chunker

Markdown files remain markdown. Plain text remains plain text. JSON stays deterministically formatted, then goes through the chunker as markdown/plain text content.

### 4. Docling adapter returns markdown, then uses the same chunker

`python/worker/parser/docling_adapter.py` already yields markdown from `export_to_markdown()`. After conversion succeeds:

- empty markdown => `skipped`
- non-empty markdown => pass through the shared chunker

This makes docling and simple produce the same downstream chunk semantics.

## Chunking Rules

### Sectioning

- A heading block starts a new section.
- Section headings stay attached to the section content they introduce.
- Content before the first heading belongs to a preamble section.
- No chunk may include blocks from multiple sections.

### Block aggregation

Blocks are formed from markdown structure, not fixed windows:

- headings
- paragraphs
- fenced code blocks
- block quotes
- contiguous list groups
- tables

Blank lines are separators, not content.

### Short-chunk merge

If an assembled chunk is below `MIN_CHUNK_CHARS`, merge it forward with the next block or next provisional chunk in the same section.

Do not merge backward across section boundaries.

### Long-chunk split

If a block or provisional chunk exceeds `MAX_CHUNK_CHARS`:

1. split on sentence-like boundaries
2. if still oversized, split on hard character limits

This preserves readable units when possible without allowing huge chunks through to embedding.

## Initial Constants

Keep constants internal and non-configurable for now:

- `MIN_CHUNK_CHARS = 400`
- `TARGET_CHUNK_CHARS = 1200`
- `MAX_CHUNK_CHARS = 1800`
- `HARD_SPLIT_CHARS = 2200`

These values are intentionally approximate. The immediate objective is to prevent single-document mega-chunks while preserving semantic grouping.

## Error Handling

- Non-local providers remain `UNSUPPORTED_PROVIDER error`.
- Unsupported suffixes remain `UNSUPPORTED_FILE_TYPE skipped`.
- Empty markdown/text remains `skipped`.
- Chunker should never emit empty `ok` chunks.

## Testing Strategy

### Unit tests

`python/tests/test_parser_simple.py`

- markdown with multiple headings yields multiple chunks
- short section content merges forward
- oversized markdown paragraph splits into multiple chunks
- fenced code block remains intact when under threshold

`python/tests/test_parser_docling.py`

- docling markdown flows through shared chunking instead of returning one raw chunk

`python/tests/test_parser_service.py`

- simple and docling paths both route through shared chunking
- unsupported suffix behavior remains skipped

### Integration tests

`python/tests/test_integration_indexing.py`

- a markdown file with multiple sections produces multiple indexed rows
- parser artifact contains joined chunk markdown in stable order

## Trade-offs

### Why not keep per-parser chunking?

That would duplicate the most important logic in two places and make chunk-size tuning inconsistent.

### Why not introduce full tokenization now?

True tokenizer-aware chunking is possible, but it adds model/runtime coupling. Character- and sentence-based limits are enough for the current performance problem and can be replaced later.

### Why not use AST-heavy markdown parsing first?

A full markdown AST would provide richer structure, but it is more implementation work than needed for this fix. A block-oriented parser with heading awareness solves the observed problem with less risk.

## Rollout

1. Add failing tests showing markdown/docling no longer return a single large chunk.
2. Implement shared chunker and wire simple/docling through it.
3. Verify index integration creates multiple vector rows for multi-section markdown.
