# Capability-Aware Index Queues Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let text indexing begin as soon as embedding is ready while image indexing waits for OCR and caption readiness, using separate queues but only one active indexing worker.

**Architecture:** Split incremental jobs into `text` and `image` queue kinds while keeping `delete` independent. Replace blind FIFO claiming with capability-aware selection driven by model status, and return startup before all models are ready. The renderer UI remains unchanged.

**Tech Stack:** Python, SQLite, pytest, Bun test

---

### Task 1: Add queue kinds to queue storage

**Files:**
- Modify: `python/worker/index/queue_store.py`
- Modify: `python/worker/index/queue.py`
- Modify: `python/worker/runtime/types.py`
- Test: `python/tests/test_index_queue.py`

**Step 1: Write the failing test**

Add assertions that:

- incremental jobs can be enqueued as `text` or `image`
- delete jobs use `delete`
- queue snapshots and claim logic preserve only one running job

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_index_queue.py -v`

Expected: FAIL until queue kinds are stored and exposed.

**Step 3: Write minimal implementation**

Add `queue_kind` persistence and plumb it through queue enqueue/claim structures without changing scheduling semantics yet.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_index_queue.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add python/worker/index/queue_store.py python/worker/index/queue.py python/worker/runtime/types.py python/tests/test_index_queue.py
git commit -m "feat: add index queue kinds"
```

### Task 2: Route incremental jobs into text and image queues

**Files:**
- Modify: `python/worker/index/queue.py`
- Modify: `python/worker/parser/service.py`
- Test: `python/tests/test_index_queue.py`

**Step 1: Write the failing test**

Add assertions that:

- image suffixes enqueue as `image`
- markdown/json/text suffixes enqueue as `text`
- delete requests remain `delete`

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_index_queue.py -v`

Expected: FAIL until queue classification exists.

**Step 3: Write minimal implementation**

Reuse parser image suffix detection to classify incremental enqueue requests into `text` or `image`.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_index_queue.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add python/worker/index/queue.py python/worker/parser/service.py python/tests/test_index_queue.py
git commit -m "feat: classify text and image index jobs"
```

### Task 3: Make model startup asynchronous for queue execution

**Files:**
- Modify: `python/worker/model/service.py`
- Modify: `python/worker/protocol/server.py`
- Modify: `python/worker/runtime/status.py`
- Test: `python/tests/test_model_service.py`
- Test: `python/tests/test_server_model_start.py`

**Step 1: Write the failing test**

Add assertions that:

- startup begins model preparation for all configured models
- startup returns before OCR/caption are ready
- embedding readiness can become true before image capability readiness
- model state changes still publish status updates

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_model_service.py python/tests/test_server_model_start.py -v`

Expected: FAIL until startup no longer blocks on full readiness.

**Step 3: Write minimal implementation**

Separate “start preparing models” from “wait for every model to be ready”, preserving per-model verify and status updates.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_model_service.py python/tests/test_server_model_start.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add python/worker/model/service.py python/worker/protocol/server.py python/worker/runtime/status.py python/tests/test_model_service.py python/tests/test_server_model_start.py
git commit -m "feat: start model preparation asynchronously"
```

### Task 4: Add capability-aware queue selection

**Files:**
- Modify: `python/worker/index/queue_store.py`
- Modify: `python/worker/index/queue.py`
- Modify: `python/worker/runtime/bootstrap.py`
- Test: `python/tests/test_index_queue.py`
- Test: `python/tests/test_integration_indexing.py`

**Step 1: Write the failing test**

Add assertions that:

- if image jobs exist but OCR/caption are not ready, text jobs are still claimed
- when both text and image queues are runnable, the older queue head wins
- delete jobs are always claimable
- only one job can be running at a time

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_index_queue.py python/tests/test_integration_indexing.py -v`

Expected: FAIL until claim logic becomes capability-aware.

**Step 3: Write minimal implementation**

Teach the worker to select the oldest runnable queue head across `delete`, `text`, and `image`, using model readiness snapshot as the gate.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_index_queue.py python/tests/test_integration_indexing.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add python/worker/index/queue_store.py python/worker/index/queue.py python/worker/runtime/bootstrap.py python/tests/test_index_queue.py python/tests/test_integration_indexing.py
git commit -m "feat: schedule runnable index queues by capability"
```

### Task 5: Wake scheduling when model readiness changes

**Files:**
- Modify: `python/worker/model/service.py`
- Modify: `python/worker/runtime/bootstrap.py`
- Test: `python/tests/test_model_runtime_integration.py`
- Test: `python/tests/test_integration_indexing.py`
- Test: `python/tests/test_dataset_indexing_integration.py`

**Step 1: Write the failing test**

Add assertions that:

- text indexing starts once embedding becomes ready even if image models are still downloading
- image jobs remain queued until OCR and caption become ready
- once OCR and caption become ready, the worker wakes and begins image indexing without a manual restart

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_model_runtime_integration.py python/tests/test_integration_indexing.py python/tests/test_dataset_indexing_integration.py -v`

Expected: FAIL until model readiness changes notify the scheduler.

**Step 3: Write minimal implementation**

Emit or hook queue wake-up signals from model readiness transitions so the worker re-evaluates runnable queues immediately.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_model_runtime_integration.py python/tests/test_integration_indexing.py python/tests/test_dataset_indexing_integration.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add python/worker/model/service.py python/worker/runtime/bootstrap.py python/tests/test_model_runtime_integration.py python/tests/test_integration_indexing.py python/tests/test_dataset_indexing_integration.py
git commit -m "feat: wake index scheduling on model readiness"
```
