# Docling Supported Formats Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Route every file format officially supported by Docling through the Docling parser path.

**Architecture:** Keep the existing two-branch parser design in `python/worker/parser/service.py`. Expand the Docling suffix allowlist to include Docling-supported local document and image formats, and verify the routing with focused parser service tests.

**Tech Stack:** Python, pytest, Docling-backed parser adapter

---

### Task 1: Add failing parser routing tests

**Files:**
- Modify: `python/tests/test_parser_service.py`
- Test: `python/tests/test_parser_service.py`

**Step 1: Write the failing test**

Add tests proving at least one image format and one newly supported document format route through `parse_docling(...)`.

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_parser_service.py -q`
Expected: FAIL because the new formats still go through the simple parser branch.

**Step 3: Write minimal implementation**

Expand the Docling suffix set in `python/worker/parser/service.py`.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_parser_service.py -q`
Expected: PASS

**Step 5: Commit**

```bash
git add python/tests/test_parser_service.py python/worker/parser/service.py docs/plans/2026-03-20-docling-supported-formats-implementation-plan.md
git commit -m "feat: route docling-supported formats through docling"
```
