# Python Parser Whitelist Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Python parser use an internal file-extension whitelist and skip unsupported files without failing indexing.

**Architecture:** Keep file-type routing inside the Python parser service so one boundary decides whether a file goes to docling, the simple parser, or a structured `skipped` result. Use explicit built-in suffix sets for supported simple-text formats and docling formats, and let the index service continue to ignore non-`ok` chunks.

**Tech Stack:** Python, pytest, parser service, index service

---

### Task 1: Add failing parser tests for whitelist behavior

**Files:**
- Modify: `python/tests/test_parser_service.py`

**Step 1: Write the failing test**

Add tests covering:
- unsupported suffix like `.mkv` returns one `skipped` chunk with a structured error.
- supported text suffix like `.json` still routes through the simple parser.

**Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_parser_service.py -q`
Expected: FAIL because unsupported suffixes currently fall through to `simple`.

**Step 3: Write minimal implementation**

Implement an internal simple-parser whitelist and unsupported-file skip result in `worker/parser/service.py`.

**Step 4: Run test to verify it passes**

Run: `cd python && uv run pytest tests/test_parser_service.py -q`
Expected: PASS

### Task 2: Verify skipped parser output does not index rows

**Files:**
- Modify: `python/tests/test_index_service.py`

**Step 1: Write the failing test**

Add a test asserting an all-`skipped` parser result yields `indexed == 0` and stores no vectors.

**Step 2: Run test to verify behavior**

Run: `cd python && uv run pytest tests/test_index_service.py -q`
Expected: PASS after parser behavior is aligned.

**Step 3: Commit**

```bash
git add docs/plans/2026-03-20-python-parser-whitelist.md python/worker/parser/service.py python/tests/test_parser_service.py python/tests/test_index_service.py
git commit -m "fix(parser): skip unsupported files by whitelist"
```
