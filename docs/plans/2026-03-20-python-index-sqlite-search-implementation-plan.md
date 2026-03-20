# Python Index SQLite Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist Python indexing requests in a real FIFO SQLite queue, persist chunks in SQLite, add SQLite FTS search plus vector recall and reranking, and return full debug search payloads.

**Architecture:** The Python worker keeps `IndexService` as the top-level orchestration layer for actual indexing work, but pushes request persistence into a FIFO SQLite queue with a separate node-intent table. A queue worker consumes queued jobs serially, skips stale jobs using node state, and delegates valid work to `IndexService`. Search becomes a composed pipeline over SQLite FTS, `zvec`, and the reranker runtime, returning intermediate debug payloads.

**Tech Stack:** Python, SQLite, FTS5, zvec, pytest

---

### Task 1: Define search and storage types

**Files:**
- Modify: `python/worker/runtime/types.py`
- Modify: `python/worker/index/types.py` if needed
- Test: `python/tests/test_runtime_types.py`

**Step 1: Write the failing test**

Add assertions for:
- search request parsing with `titleOnly`
- search response debug payload types

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_runtime_types.py -q`

**Step 3: Write minimal implementation**

Add typed request/response/debug payload structures.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_runtime_types.py -q`

**Step 5: Commit**

```bash
git add python/worker/runtime/types.py python/tests/test_runtime_types.py
git commit -m "feat: add typed python search debug payloads"
```

### Task 2: Replace Snapshot Queue With FIFO SQLite Jobs

**Files:**
- Create: `python/worker/index/queue_store.py`
- Modify: `python/worker/index/queue.py`
- Modify: `python/worker/runtime/status.py` if queue status publication needs a public helper
- Test: `python/tests/test_index_queue.py`

**Step 1: Write the failing test**

Add tests for:
- FIFO enqueue order
- coalescing repeated `index` jobs for the same node
- `delete` superseding stale `index` work
- `queueDepth` / running state derived from SQLite

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_index_queue.py -q`

**Step 3: Write minimal implementation**

Implement:
- `index_jobs`
- `index_node_state`
- FIFO reserve/mark-running/mark-done/mark-cancelled logic
- serial queue worker over persisted jobs
- queue status snapshots from SQLite counts

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_index_queue.py -q`

**Step 5: Commit**

```bash
git add python/worker/index/queue_store.py python/worker/index/queue.py python/worker/runtime/status.py python/tests/test_index_queue.py
git commit -m "feat: add fifo sqlite index job queue"
```

### Task 3: Wire FIFO Queue Worker To IndexService

**Files:**
- Modify: `python/worker/index/queue.py`
- Modify: `python/worker/protocol/server.py`
- Test: `python/tests/test_server.py`
- Test: `python/tests/test_integration_indexing.py`

**Step 1: Write the failing test**

Add tests asserting:
- `index_node` RPC enqueues and returns ack-style result
- queue worker executes jobs serially
- stale jobs are skipped when node intent changes

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_server.py python/tests/test_integration_indexing.py -q`

**Step 3: Write minimal implementation**

Wire Bun-facing requests into FIFO queue persistence and worker execution.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_server.py python/tests/test_integration_indexing.py -q`

**Step 5: Commit**

```bash
git add python/worker/index/queue.py python/worker/protocol/server.py python/tests/test_server.py python/tests/test_integration_indexing.py
git commit -m "feat: drive indexing through fifo queue worker"
```

### Task 4: Add SQLite chunk store and FTS5

**Files:**
- Create: `python/worker/index/chunk_store.py`
- Modify: `python/worker/index/service.py`
- Test: `python/tests/test_index_service.py`
- Test: `python/tests/test_integration_indexing.py`

**Step 1: Write the failing test**

Add tests asserting:
- chunk rows are persisted in SQLite
- FTS documents are queryable

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_index_service.py python/tests/test_integration_indexing.py -q`

**Step 3: Write minimal implementation**

Implement chunk store and write chunk rows during indexing.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_index_service.py python/tests/test_integration_indexing.py -q`

**Step 5: Commit**

```bash
git add python/worker/index/chunk_store.py python/worker/index/service.py python/tests/test_index_service.py python/tests/test_integration_indexing.py
git commit -m "feat: persist indexed chunks in sqlite fts"
```

### Task 5: Add composed search service

**Files:**
- Create: `python/worker/index/search_service.py`
- Modify: `python/worker/index/service.py`
- Test: `python/tests/test_index_service.py`

**Step 1: Write the failing test**

Add tests for:
- FTS recall
- vector recall
- merged candidates
- debug payload structure

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_index_service.py -q`

**Step 3: Write minimal implementation**

Implement search pipeline and return debug payload.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_index_service.py -q`

**Step 5: Commit**

```bash
git add python/worker/index/search_service.py python/worker/index/service.py python/tests/test_index_service.py
git commit -m "feat: combine fts and vector recall in python search"
```

### Task 6: Add reranker integration and titleOnly support

**Files:**
- Modify: `python/worker/index/search_service.py`
- Modify: `python/worker/protocol/server.py`
- Test: `python/tests/test_server.py`
- Test: `python/tests/test_index_service.py`

**Step 1: Write the failing test**

Add tests for:
- `titleOnly` search behavior
- reranker ordering

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_server.py python/tests/test_index_service.py -q`

**Step 3: Write minimal implementation**

Pass `titleOnly` into search and apply reranking before final truncation.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_server.py python/tests/test_index_service.py -q`

**Step 5: Commit**

```bash
git add python/worker/index/search_service.py python/worker/protocol/server.py python/tests/test_server.py python/tests/test_index_service.py
git commit -m "feat: add reranked python search with title-only mode"
```

### Task 7: Expand integration coverage

**Files:**
- Modify: `python/tests/test_dataset_indexing_integration.py`
- Modify: `python/tests/test_integration_indexing.py`

**Step 1: Write the failing test**

Add end-to-end assertions for:
- SQLite chunk persistence
- debug search payload
- reranked final results

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_dataset_indexing_integration.py python/tests/test_integration_indexing.py -q`

**Step 3: Write minimal implementation**

Adjust integration scaffolding to use the new search response shape.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_dataset_indexing_integration.py python/tests/test_integration_indexing.py -q`

**Step 5: Commit**

```bash
git add python/tests/test_dataset_indexing_integration.py python/tests/test_integration_indexing.py
git commit -m "test: cover python sqlite and rerank search integration"
```

### Task 8: Run full targeted verification

**Files:**
- No code changes required unless regressions appear

**Step 1: Run full Python verification**

Run: `bun run python:test`

**Step 2: Run Bun-side targeted verification**

Run: `bun test src/bun/python/integration.test.ts src/bun/python/runtime.test.ts`

**Step 3: Fix regressions if needed**

Only if failures appear.

**Step 4: Commit final cleanups**

```bash
git add -A
git commit -m "test: verify python sqlite search stack"
```
