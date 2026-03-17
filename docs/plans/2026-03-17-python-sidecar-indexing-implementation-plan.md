# Python Sidecar Indexing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Bun-owned `model`, `parser`, and `indexing/vector` runtime with a Python sidecar process while preserving the current Bun-owned VFS and renderer integration.

**Architecture:** Bun remains the desktop shell, VFS owner, and renderer RPC layer. A Python sidecar started over `stdio` becomes the source of truth for model lifecycle, parsing, indexing queueing, and vector persistence. Bun forwards file events and UI requests to Python and maps Python events back into shared renderer status types.

**Tech Stack:** Bun, TypeScript, Bun test, Electrobun RPC, Python 3, `pytest`, `docling`, zvec, line-delimited JSON over `stdio`

---

### Task 1: Add the shared Python worker contract document and fixtures

**Files:**
- Create: `docs/plans/python-sidecar-protocol.md`
- Create: `src/shared/python-worker.ts`
- Test: `src/shared/python-worker.test.ts`

**Step 1: Write the failing test**

Add `src/shared/python-worker.test.ts` covering:

- request envelope shape with `id`, `method`, and `params`
- response envelope shape with `id`, `result`, and `error`
- event envelope shape with `type` and `payload`
- TypeScript guards that reject malformed protocol frames

**Step 2: Run test to verify it fails**

Run: `bun test src/shared/python-worker.test.ts`
Expected: FAIL because the shared Python worker protocol module does not exist.

**Step 3: Write minimal implementation**

Create:

- `docs/plans/python-sidecar-protocol.md` documenting the line-delimited JSON protocol
- `src/shared/python-worker.ts` with:
  - `PythonWorkerRequest`
  - `PythonWorkerResponse`
  - `PythonWorkerEvent`
  - `isPythonWorkerRequestFrame(...)`
  - `isPythonWorkerResponseFrame(...)`
  - `isPythonWorkerEventFrame(...)`

Keep this file schema-only. Do not add transport logic yet.

**Step 4: Run test to verify it passes**

Run: `bun test src/shared/python-worker.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add docs/plans/python-sidecar-protocol.md src/shared/python-worker.ts src/shared/python-worker.test.ts
git commit -m "feat: add python worker protocol contract"
```

### Task 2: Bootstrap the Python workspace and test runner

**Files:**
- Modify: `package.json`
- Create: `python/pyproject.toml`
- Create: `python/pytest.ini`
- Create: `python/worker/__init__.py`
- Create: `python/tests/test_smoke.py`

**Step 1: Write the failing test**

Add `python/tests/test_smoke.py` with a simple import test:

```python
from worker import __name__


def test_worker_package_imports():
    assert __name__ == "worker"
```

**Step 2: Run test to verify it fails**

Run: `python -m pytest python/tests/test_smoke.py -v`
Expected: FAIL because the Python package and test config do not exist.

**Step 3: Write minimal implementation**

Add:

- `python/pyproject.toml` with project metadata and initial dependencies
- `python/pytest.ini`
- `python/worker/__init__.py`
- `package.json` scripts such as:
  - `python:test`
  - `python:worker`

Keep dependencies minimal at this stage. Add `pytest` only.

**Step 4: Run test to verify it passes**

Run: `python -m pytest python/tests/test_smoke.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add package.json python/pyproject.toml python/pytest.ini python/worker/__init__.py python/tests/test_smoke.py
git commit -m "feat: bootstrap python worker workspace"
```

### Task 3: Implement Python frame encoding and decoding

**Files:**
- Create: `python/worker/protocol.py`
- Create: `python/tests/test_protocol.py`

**Step 1: Write the failing test**

Add tests in `python/tests/test_protocol.py` for:

- serializing a request frame into a single newline-terminated JSON string
- decoding request, response, and event frames
- rejecting invalid JSON and invalid frame shapes

**Step 2: Run test to verify it fails**

Run: `python -m pytest python/tests/test_protocol.py -v`
Expected: FAIL because `protocol.py` does not exist.

**Step 3: Write minimal implementation**

Implement:

- `encode_frame(frame: dict) -> bytes`
- `decode_frame(line: bytes) -> dict`
- lightweight validation helpers for request, response, and event frames

Do not add RPC dispatch yet.

**Step 4: Run test to verify it passes**

Run: `python -m pytest python/tests/test_protocol.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add python/worker/protocol.py python/tests/test_protocol.py
git commit -m "feat: add python frame protocol helpers"
```

### Task 4: Add Bun-side Python process transport

**Files:**
- Create: `src/bun/python-worker-transport.ts`
- Create: `src/bun/python-worker-transport.test.ts`
- Modify: `src/bun/rpc-transport.ts`

**Step 1: Write the failing test**

Add transport tests covering:

- spawn configuration for the Python worker command
- line-based parsing of stdout frames
- request/response correlation by `id`
- rejection on malformed frames
- process-exit handling for pending requests

Use a stub child process in tests instead of launching Python.

**Step 2: Run test to verify it fails**

Run: `bun test src/bun/python-worker-transport.test.ts`
Expected: FAIL because the transport module does not exist.

**Step 3: Write minimal implementation**

Implement `src/bun/python-worker-transport.ts` with:

- `createPythonWorkerTransport(...)`
- `request(method, params)`
- `subscribeEvents(listener)`
- `start()`
- `stop()`

Parse stdout by newline. Keep stderr logging simple.

**Step 4: Run test to verify it passes**

Run: `bun test src/bun/python-worker-transport.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/bun/python-worker-transport.ts src/bun/python-worker-transport.test.ts src/bun/rpc-transport.ts
git commit -m "feat: add bun python worker transport"
```

### Task 5: Add Python request dispatch and startup handshake

**Files:**
- Create: `python/worker/server.py`
- Create: `python/tests/test_server.py`
- Modify: `python/worker/protocol.py`

**Step 1: Write the failing test**

Add tests for:

- handling `start`
- handling `shutdown`
- returning errors for unknown methods
- emitting a `worker_health_changed` event after startup

Test the dispatcher directly without real stdio first.

**Step 2: Run test to verify it fails**

Run: `python -m pytest python/tests/test_server.py -v`
Expected: FAIL because the server module does not exist.

**Step 3: Write minimal implementation**

Implement:

- method dispatch table
- startup handshake result payload
- shutdown path
- in-memory event sink for tests

The worker can still use placeholder services for all business methods.

**Step 4: Run test to verify it passes**

Run: `python -m pytest python/tests/test_server.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add python/worker/server.py python/worker/protocol.py python/tests/test_server.py
git commit -m "feat: add python worker request dispatcher"
```

### Task 6: Add Python status store primitives

**Files:**
- Create: `python/worker/status.py`
- Create: `python/tests/test_status.py`

**Step 1: Write the failing test**

Add tests for:

- default `model`, `index`, and `vector` status snapshots
- immutable update helpers
- event emission payloads when status changes

**Step 2: Run test to verify it fails**

Run: `python -m pytest python/tests/test_status.py -v`
Expected: FAIL because the status module does not exist.

**Step 3: Write minimal implementation**

Implement:

- `ModelStatusStore`
- `IndexStatusStore`
- `VectorStatusStore`
- helper methods that return renderer-compatible payload shapes

Keep vector status fields aligned with the design:

- `available`
- `chunkCount`
- `lastUpdatedAt`
- `error`

**Step 4: Run test to verify it passes**

Run: `python -m pytest python/tests/test_status.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add python/worker/status.py python/tests/test_status.py
git commit -m "feat: add python worker status stores"
```

### Task 7: Extend shared renderer status types for Python-owned queue and vector fields

**Files:**
- Modify: `src/shared/index-status.ts`
- Modify: `src/shared/vector-db-status.ts`
- Test: `src/shared/index-status.test.ts`
- Create: `src/shared/vector-db-status.test.ts`

**Step 1: Write the failing test**

Add tests asserting:

- `RendererIndexStatus` includes `queueDepth`
- `RendererVectorDbStatus` includes `lastUpdatedAt` and `error`
- fallback objects contain the new fields

**Step 2: Run test to verify it fails**

Run: `bun test src/shared/index-status.test.ts src/shared/vector-db-status.test.ts`
Expected: FAIL because the new fields do not exist.

**Step 3: Write minimal implementation**

Update the shared status types and fallback values.

Do not modify renderer UI yet.

**Step 4: Run test to verify it passes**

Run: `bun test src/shared/index-status.test.ts src/shared/vector-db-status.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/index-status.ts src/shared/vector-db-status.ts src/shared/index-status.test.ts src/shared/vector-db-status.test.ts
git commit -m "feat: extend shared python-owned status types"
```

### Task 8: Add Bun-side worker lifecycle management

**Files:**
- Modify: `src/bun/app.container.ts`
- Create: `src/bun/python-worker-runtime.ts`
- Create: `src/bun/python-worker-runtime.test.ts`

**Step 1: Write the failing test**

Add tests covering:

- Python worker startup during app initialization
- bounded restart after unexpected exit
- clean shutdown on app close
- initial `get_status_snapshot` hydration after a successful restart

Use a fake transport rather than a real process.

**Step 2: Run test to verify it fails**

Run: `bun test src/bun/python-worker-runtime.test.ts`
Expected: FAIL because lifecycle orchestration does not exist.

**Step 3: Write minimal implementation**

Implement a runtime coordinator with:

- `start()`
- `stop()`
- `subscribeStatusEvents()`
- bounded restart policy
- snapshot hydration hook

Wire it into `src/bun/app.container.ts` without deleting existing TS services yet. Gate old services behind a temporary compatibility path if needed.

**Step 4: Run test to verify it passes**

Run: `bun test src/bun/python-worker-runtime.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/bun/app.container.ts src/bun/python-worker-runtime.ts src/bun/python-worker-runtime.test.ts
git commit -m "feat: add python worker runtime lifecycle"
```

### Task 9: Add Python reverse-call client for Bun-owned VFS access

**Files:**
- Create: `python/worker/bun_client.py`
- Create: `python/tests/test_bun_client.py`
- Modify: `python/worker/server.py`

**Step 1: Write the failing test**

Add tests covering:

- requesting `get_node_metadata`
- requesting `read_node_content`
- handling Bun error responses
- optional temporary-file materialization helper

Use a fake request callback in tests.

**Step 2: Run test to verify it fails**

Run: `python -m pytest python/tests/test_bun_client.py -v`
Expected: FAIL because the Bun client module does not exist.

**Step 3: Write minimal implementation**

Implement a reverse-call client abstraction used by Python services:

- `get_node_metadata(node_id)`
- `read_node_content(node_id)`
- `materialize_node_file(node_id)` returning a context-managed temp path

Keep `server.py` responsible for wiring this client to the transport.

**Step 4: Run test to verify it passes**

Run: `python -m pytest python/tests/test_bun_client.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add python/worker/bun_client.py python/worker/server.py python/tests/test_bun_client.py
git commit -m "feat: add bun reverse-call client for python worker"
```

### Task 10: Implement the lightweight Python parser path

**Files:**
- Create: `python/worker/parser_simple.py`
- Create: `python/tests/test_parser_simple.py`

**Step 1: Write the failing test**

Add tests for:

- markdown input producing normalized chunks
- plain text input producing normalized chunks
- JSON input producing normalized text chunks
- empty content producing a skipped result

**Step 2: Run test to verify it fails**

Run: `python -m pytest python/tests/test_parser_simple.py -v`
Expected: FAIL because the simple parser module does not exist.

**Step 3: Write minimal implementation**

Implement:

- basic format detection by file extension or media type
- simple text normalization
- deterministic chunk shape matching the sidecar indexing contract

Use a conservative chunker first. Do not integrate `docling` here.

**Step 4: Run test to verify it passes**

Run: `python -m pytest python/tests/test_parser_simple.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add python/worker/parser_simple.py python/tests/test_parser_simple.py
git commit -m "feat: add simple python parser path"
```

### Task 11: Implement the `docling` parser adapter

**Files:**
- Modify: `python/pyproject.toml`
- Create: `python/worker/parser_docling.py`
- Create: `python/tests/test_parser_docling.py`

**Step 1: Write the failing test**

Add tests covering:

- selecting the `docling` path for PDF and DOCX-like inputs
- mapping `docling` output into normalized chunks
- surfacing parser failures as error results instead of uncaught crashes

Stub `docling` in tests. Do not depend on a real model-heavy parse during unit tests.

**Step 2: Run test to verify it fails**

Run: `python -m pytest python/tests/test_parser_docling.py -v`
Expected: FAIL because the adapter and dependency wiring do not exist.

**Step 3: Write minimal implementation**

Add `docling` to `python/pyproject.toml` and implement:

- file suitability detection
- temporary-file based `docling` invocation when needed
- adapter logic that maps parsed document sections into normalized chunks

Keep the adapter thin. Push orchestration elsewhere.

**Step 4: Run test to verify it passes**

Run: `python -m pytest python/tests/test_parser_docling.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add python/pyproject.toml python/worker/parser_docling.py python/tests/test_parser_docling.py
git commit -m "feat: add docling parser adapter"
```

### Task 12: Add parser selection orchestration

**Files:**
- Create: `python/worker/parser_service.py`
- Create: `python/tests/test_parser_service.py`
- Modify: `python/worker/parser_simple.py`
- Modify: `python/worker/parser_docling.py`

**Step 1: Write the failing test**

Add tests for:

- selecting the simple parser for markdown and text nodes
- selecting `docling` for complex document nodes
- returning a unified chunk list shape across both paths
- bubbling structured error results into the indexing layer

**Step 2: Run test to verify it fails**

Run: `python -m pytest python/tests/test_parser_service.py -v`
Expected: FAIL because the parser service does not exist.

**Step 3: Write minimal implementation**

Implement `ParserService` with:

- parser path selection
- call-through to Bun metadata and content access
- normalized chunk output
- structured parse result status

**Step 4: Run test to verify it passes**

Run: `python -m pytest python/tests/test_parser_service.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add python/worker/parser_service.py python/worker/parser_simple.py python/worker/parser_docling.py python/tests/test_parser_service.py
git commit -m "feat: add python parser orchestration"
```

### Task 13: Add Python vector repository wrapper

**Files:**
- Create: `python/worker/vector_repository.py`
- Create: `python/tests/test_vector_repository.py`

**Step 1: Write the failing test**

Add tests for:

- opening a zvec-backed collection at a configured path
- inserting normalized chunk vectors
- deleting vectors by `nodeId`
- reporting `chunkCount`

Stub zvec if needed to keep tests lightweight.

**Step 2: Run test to verify it fails**

Run: `python -m pytest python/tests/test_vector_repository.py -v`
Expected: FAIL because the vector repository wrapper does not exist.

**Step 3: Write minimal implementation**

Implement a repository wrapper with:

- `upsert_chunks(...)`
- `delete_by_node_id(...)`
- `count_chunks()`
- path-based initialization

Keep repository responsibilities separate from queue orchestration.

**Step 4: Run test to verify it passes**

Run: `python -m pytest python/tests/test_vector_repository.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add python/worker/vector_repository.py python/tests/test_vector_repository.py
git commit -m "feat: add python vector repository wrapper"
```

### Task 14: Add Python model service

**Files:**
- Create: `python/worker/model_service.py`
- Create: `python/tests/test_model_service.py`

**Step 1: Write the failing test**

Add tests covering:

- default idle model status
- local embedding model verification
- local reranker model verification
- progress updates for downloads
- error propagation into model status

Stub remote fetches and local runtime loads.

**Step 2: Run test to verify it fails**

Run: `python -m pytest python/tests/test_model_service.py -v`
Expected: FAIL because the model service does not exist.

**Step 3: Write minimal implementation**

Implement a Python model service owning:

- model status transitions
- local model verification and download hooks
- runtime accessors for embedding and reranking

Keep external dependency wiring injectable for tests.

**Step 4: Run test to verify it passes**

Run: `python -m pytest python/tests/test_model_service.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add python/worker/model_service.py python/tests/test_model_service.py
git commit -m "feat: add python model service"
```

### Task 15: Add Python indexing queue with incremental serial and rebuild bounded-concurrency modes

**Files:**
- Create: `python/worker/index_queue.py`
- Create: `python/tests/test_index_queue.py`

**Step 1: Write the failing test**

Add tests for:

- incremental `index_node` jobs executing serially
- `rebuild_all` running with a bounded worker count
- queue depth updates
- `activeNodeName`, `processedFiles`, and `totalFiles` updates
- failure of one rebuild item not aborting the entire rebuild

**Step 2: Run test to verify it fails**

Run: `python -m pytest python/tests/test_index_queue.py -v`
Expected: FAIL because the queue module does not exist.

**Step 3: Write minimal implementation**

Implement:

- incremental FIFO queue
- rebuild executor with a fixed concurrency limit
- hooks into index status updates
- task cancellation on shutdown

Do not wire the full indexing pipeline yet.

**Step 4: Run test to verify it passes**

Run: `python -m pytest python/tests/test_index_queue.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add python/worker/index_queue.py python/tests/test_index_queue.py
git commit -m "feat: add python indexing queue"
```

### Task 16: Add Python indexing service orchestration

**Files:**
- Create: `python/worker/index_service.py`
- Create: `python/tests/test_index_service.py`
- Modify: `python/worker/parser_service.py`
- Modify: `python/worker/vector_repository.py`
- Modify: `python/worker/model_service.py`

**Step 1: Write the failing test**

Add tests covering:

- `index_node` reading metadata and content through Bun
- parser output flowing into embeddings and vector writes
- `delete_node` clearing indexed data
- vector status `chunkCount` updates after writes and deletes
- search delegating to repository-backed retrieval

Stub embeddings and reranking until the real model runtime is wired.

**Step 2: Run test to verify it fails**

Run: `python -m pytest python/tests/test_index_service.py -v`
Expected: FAIL because the indexing service does not exist.

**Step 3: Write minimal implementation**

Implement `IndexService` with:

- `index_node`
- `delete_node`
- `rebuild_all`
- `search`
- vector status update calls after mutations

Wire it to `ParserService`, `ModelService`, and `VectorRepository`.

**Step 4: Run test to verify it passes**

Run: `python -m pytest python/tests/test_index_service.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add python/worker/index_service.py python/worker/parser_service.py python/worker/vector_repository.py python/worker/model_service.py python/tests/test_index_service.py
git commit -m "feat: add python indexing service"
```

### Task 17: Wire Python business services into the server methods

**Files:**
- Modify: `python/worker/server.py`
- Create: `python/tests/test_server_methods.py`

**Step 1: Write the failing test**

Add tests covering:

- `get_status_snapshot`
- `index_node`
- `delete_node`
- `rebuild_all`
- `search`

Verify server methods delegate to the correct Python services and emit events on state changes.

**Step 2: Run test to verify it fails**

Run: `python -m pytest python/tests/test_server_methods.py -v`
Expected: FAIL because the methods are still placeholders.

**Step 3: Write minimal implementation**

Wire the server dispatcher to:

- status stores
- model service
- index queue
- index service
- Bun reverse-call client

Keep initialization order explicit and testable.

**Step 4: Run test to verify it passes**

Run: `python -m pytest python/tests/test_server_methods.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add python/worker/server.py python/tests/test_server_methods.py
git commit -m "feat: wire python server methods"
```

### Task 18: Add Bun handlers for Python reverse calls into VFS

**Files:**
- Modify: `src/bun/index.ts`
- Create: `src/bun/python-worker-reverse-calls.test.ts`

**Step 1: Write the failing test**

Add tests covering:

- returning metadata for a valid node
- returning file bytes for a valid node
- returning structured errors for missing nodes
- creating and cleaning up temporary files when materialization is requested

Use fake VFS objects in tests.

**Step 2: Run test to verify it fails**

Run: `bun test src/bun/python-worker-reverse-calls.test.ts`
Expected: FAIL because the reverse-call handlers do not exist.

**Step 3: Write minimal implementation**

Implement reverse-call handlers in `src/bun/index.ts` or a small extracted helper module and connect them to the Python transport.

Keep file materialization isolated in helper functions so cleanup logic stays testable.

**Step 4: Run test to verify it passes**

Run: `bun test src/bun/python-worker-reverse-calls.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/bun/index.ts src/bun/python-worker-reverse-calls.test.ts
git commit -m "feat: add bun reverse-call handlers for python worker"
```

### Task 19: Replace Bun-owned index/model/vector reads with Python-backed status mapping

**Files:**
- Modify: `src/bun/index.ts`
- Modify: `src/shared/model-status.ts`
- Modify: `src/shared/index-status.ts`
- Modify: `src/shared/vector-db-status.ts`
- Test: `src/renderer/App.test.tsx`
- Test: `src/renderer/components/shell/index-status-indicator.test.tsx`
- Test: `src/renderer/components/shell/vector-db-status-indicator.test.tsx`

**Step 1: Write the failing test**

Add or update tests asserting:

- renderer receives Python-backed `model`, `index`, and `vector` status snapshots
- `queueDepth` is displayed or included in tooltip content for index status
- vector status can represent error and last update data without breaking existing rendering

**Step 2: Run test to verify it fails**

Run: `bun test src/renderer/App.test.tsx src/renderer/components/shell/index-status-indicator.test.tsx src/renderer/components/shell/vector-db-status-indicator.test.tsx`
Expected: FAIL because Bun still maps status from local TypeScript services.

**Step 3: Write minimal implementation**

Update Bun status mapping to consume Python status snapshots and events.

Only after tests pass, delete dead code paths that read status from the old TS-owned services.

**Step 4: Run test to verify it passes**

Run: `bun test src/renderer/App.test.tsx src/renderer/components/shell/index-status-indicator.test.tsx src/renderer/components/shell/vector-db-status-indicator.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/bun/index.ts src/shared/model-status.ts src/shared/index-status.ts src/shared/vector-db-status.ts src/renderer/App.test.tsx src/renderer/components/shell/index-status-indicator.test.tsx src/renderer/components/shell/vector-db-status-indicator.test.tsx
git commit -m "feat: map renderer status from python worker"
```

### Task 20: Route VFS node events to Python indexing commands

**Files:**
- Modify: `src/bun/app.container.ts`
- Modify: `src/bun/index.ts`
- Create: `src/bun/python-worker-indexing-hooks.test.ts`

**Step 1: Write the failing test**

Add tests covering:

- `afterUpdateContent` sending `index_node`
- `afterDelete` sending `delete_node`
- recovery-triggered `rebuild_all`
- error logging when Python requests fail

**Step 2: Run test to verify it fails**

Run: `bun test src/bun/python-worker-indexing-hooks.test.ts`
Expected: FAIL because Bun still calls the old local indexing service.

**Step 3: Write minimal implementation**

Replace the local indexing hook path with Python worker calls.

At the end of this task, remove or quarantine the old TypeScript `createIndexingServiceFromConfig(...)`, `createParserService(...)`, and `createModelService(...)` bootstrap paths from normal runtime creation.

**Step 4: Run test to verify it passes**

Run: `bun test src/bun/python-worker-indexing-hooks.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/bun/app.container.ts src/bun/index.ts src/bun/python-worker-indexing-hooks.test.ts
git commit -m "feat: route vfs indexing hooks to python worker"
```

### Task 21: Add Bun to Python integration tests for indexing lifecycle

**Files:**
- Create: `src/bun/python-worker.integration.test.ts`

**Step 1: Write the failing test**

Add an integration-style test covering:

- starting the worker runtime
- sending `index_node`
- receiving index and vector status updates
- handling `delete_node`
- graceful shutdown

Use a fake Python server implementation or a controlled fixture process if full Python execution is too heavy for routine tests.

**Step 2: Run test to verify it fails**

Run: `bun test src/bun/python-worker.integration.test.ts`
Expected: FAIL because the end-to-end worker lifecycle is not fully wired.

**Step 3: Write minimal implementation**

Fill the last missing integration seams so the Bun side and Python side can exercise the protocol end-to-end under test.

Keep the test deterministic. Avoid dependency on heavyweight real document parsing.

**Step 4: Run test to verify it passes**

Run: `bun test src/bun/python-worker.integration.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/bun/python-worker.integration.test.ts
git commit -m "test: cover bun python worker integration lifecycle"
```

### Task 22: Add Python integration tests for parser and indexing flow

**Files:**
- Create: `python/tests/test_integration_indexing.py`
- Modify: `python/tests/test_parser_docling.py`

**Step 1: Write the failing test**

Add tests covering:

- simple-file parsing through the full Python indexing path
- complex-document parsing through the `docling` adapter with stubs
- queue-driven indexing updating vector counts and index status

**Step 2: Run test to verify it fails**

Run: `python -m pytest python/tests/test_integration_indexing.py -v`
Expected: FAIL because the full indexing path is not yet fully integrated.

**Step 3: Write minimal implementation**

Close any missing gaps in Python service wiring so the integration tests pass.

Keep `docling` stubbed in integration tests unless a separate slow-test path is introduced.

**Step 4: Run test to verify it passes**

Run: `python -m pytest python/tests/test_integration_indexing.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add python/tests/test_integration_indexing.py python/tests/test_parser_docling.py
git commit -m "test: add python indexing integration coverage"
```

### Task 23: Remove or isolate the obsolete Bun-owned runtime paths

**Files:**
- Modify: `src/bun/app.container.ts`
- Modify: `src/bun/index.ts`
- Modify: `packages/model/src/index.ts`
- Modify: `packages/parser/src/index.ts`
- Modify: `packages/indexing/src/index.ts`

**Step 1: Write the failing test**

Add or update tests to assert:

- Bun runtime no longer depends on local `packages/model`, `packages/parser`, and `packages/indexing` services in normal startup
- any remaining imports are compatibility-only and not part of the app bootstrap path

**Step 2: Run test to verify it fails**

Run: `bun test src/bun/app.container.test.ts`
Expected: FAIL because app bootstrap still directly constructs the old services.

**Step 3: Write minimal implementation**

Remove the old runtime path from normal app bootstrap or isolate it behind an explicit fallback flag used only during migration.

Do not delete packages if tests or tooling still need them.

**Step 4: Run test to verify it passes**

Run: `bun test src/bun/app.container.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/bun/app.container.ts src/bun/index.ts packages/model/src/index.ts packages/parser/src/index.ts packages/indexing/src/index.ts
git commit -m "refactor: retire bun-owned indexing runtime from app bootstrap"
```

### Task 24: Run verification suite and document developer setup

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Step 1: Write the failing test**

Add documentation checklist items in the task itself. No automated doc test is required.

Required coverage:

- Python environment setup
- installing Python dependencies
- running Bun tests
- running Python tests
- launching the desktop app with the Python sidecar

**Step 2: Run verification commands**

Run:

```bash
bun test
python -m pytest python/tests -v
```

Expected:

- Bun tests PASS
- Python tests PASS

If either command fails, fix the code before continuing.

**Step 3: Write minimal implementation**

Update `README.md` and `README.zh-CN.md` with the Python worker setup and verification commands.

Keep the docs strictly aligned with the actual commands used during verification.

**Step 4: Run verification again**

Run:

```bash
bun test
python -m pytest python/tests -v
```

Expected:

- Bun tests PASS
- Python tests PASS

**Step 5: Commit**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: add python worker setup and verification"
```
