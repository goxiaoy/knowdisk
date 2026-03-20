# Unified Markdown Chunking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Route both simple and docling parser outputs through one markdown chunking pipeline so markdown-heavy files produce multiple embedding chunks instead of one oversized row.

**Architecture:** Introduce a shared markdown chunker module that consumes normalized markdown text and emits `ParsedChunk[]` using heading-aware, block-aware, streaming-style assembly. Keep parser service responsible for routing file types, while simple and docling adapters produce markdown for the shared chunker.

**Tech Stack:** Python, pytest, existing parser/index services

---

### Task 1: Add failing simple-parser tests for markdown chunking

**Files:**
- Modify: `python/tests/test_parser_simple.py`

**Step 1: Write the failing test**

Add tests for:
- markdown with multiple headings yields multiple chunks.
- short sections merge forward within the same section.
- oversized paragraph content splits into multiple chunks.

**Step 2: Run test to verify it fails**

Run: `uv run --project python pytest python/tests/test_parser_simple.py -q`
Expected: FAIL because simple parser currently returns a single `ok` chunk.

**Step 3: Write minimal implementation**

Create the shared markdown chunker and wire `simple.py` to use it.

**Step 4: Run test to verify it passes**

Run: `uv run --project python pytest python/tests/test_parser_simple.py -q`
Expected: PASS

### Task 2: Add failing docling/parser-service tests for unified path

**Files:**
- Modify: `python/tests/test_parser_docling.py`
- Modify: `python/tests/test_parser_service.py`

**Step 1: Write the failing test**

Add tests showing:
- docling markdown is chunked into multiple chunks when headings/length require it.
- parser service still routes `.pdf` to docling and text files to simple, but both now return chunked markdown results.

**Step 2: Run test to verify it fails**

Run: `uv run --project python pytest python/tests/test_parser_docling.py python/tests/test_parser_service.py -q`
Expected: FAIL because docling currently returns one raw markdown chunk.

**Step 3: Write minimal implementation**

Update `docling_adapter.py` and any routing glue to call the shared chunker.

**Step 4: Run test to verify it passes**

Run: `uv run --project python pytest python/tests/test_parser_docling.py python/tests/test_parser_service.py -q`
Expected: PASS

### Task 3: Verify indexing produces multiple rows for multi-section markdown

**Files:**
- Modify: `python/tests/test_integration_indexing.py`

**Step 1: Write the failing test**

Add an integration test where one markdown file with multiple sections indexes into more than one chunk row.

**Step 2: Run test to verify it fails**

Run: `uv run --project python pytest python/tests/test_integration_indexing.py -q`
Expected: FAIL because the markdown file is currently indexed as one row.

**Step 3: Write minimal implementation**

Finish any remaining parser/index adjustments needed for stable multi-row output and markdown artifact persistence.

**Step 4: Run test to verify it passes**

Run: `uv run --project python pytest python/tests/test_integration_indexing.py -q`
Expected: PASS

### Task 4: Final verification

**Files:**
- Modify: `python/worker/parser/markdown_chunker.py`
- Modify: `python/worker/parser/simple.py`
- Modify: `python/worker/parser/docling_adapter.py`
- Modify: `python/worker/parser/service.py`
- Modify: tests listed above

**Step 1: Run focused verification**

Run: `uv run --project python pytest python/tests/test_parser_simple.py python/tests/test_parser_docling.py python/tests/test_parser_service.py python/tests/test_index_service.py python/tests/test_integration_indexing.py -q`

Expected: PASS

**Step 2: Commit**

```bash
git add docs/plans/2026-03-20-unified-markdown-chunking-design.md docs/plans/2026-03-20-unified-markdown-chunking-implementation.md python/worker/parser/markdown_chunker.py python/worker/parser/simple.py python/worker/parser/docling_adapter.py python/worker/parser/service.py python/tests/test_parser_simple.py python/tests/test_parser_docling.py python/tests/test_parser_service.py python/tests/test_integration_indexing.py
git commit -m "feat(parser): unify markdown chunking before embedding"
```
