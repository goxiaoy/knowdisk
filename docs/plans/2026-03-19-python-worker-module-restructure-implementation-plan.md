# Python Worker Module Restructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize the Python worker into domain folders and replace broad dictionary-based interfaces with strongly typed protocol and domain objects without changing runtime behavior.

**Architecture:** First introduce typed protocol and domain models, then migrate module interfaces, then move modules into domain packages, and finally thin the runtime entrypoint. Keep JSON dictionaries at the stdio boundary only, and preserve all current worker semantics.

**Tech Stack:** Python 3.12, `dataclasses`, `TypedDict`, `Protocol`, `pytest`, Bun worker runtime tests

---

### Task 1: Add protocol type models

**Files:**
- Create: `python/worker/protocol/types.py`
- Modify: `python/worker/protocol.py`
- Test: `python/tests/test_protocol.py`

**Step 1: Write the failing test**

Add a test in `python/tests/test_protocol.py` that imports the new protocol type helpers and asserts a decoded `start` request can be narrowed into a typed start payload shape.

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_protocol.py -v`
Expected: FAIL because `worker.protocol.types` or the new narrowing helper does not exist.

**Step 3: Write minimal implementation**

Create `python/worker/protocol/types.py` with:
- `TypedDict` definitions for request, response, event, and start payloads
- helper type aliases for worker frame unions

Update `python/worker/protocol.py` to use these types at the public function boundaries.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_protocol.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add python/worker/protocol.py python/worker/protocol/types.py python/tests/test_protocol.py
git commit -m "refactor: add typed python worker protocol models"
```

### Task 2: Add parser domain types

**Files:**
- Create: `python/worker/parser/types.py`
- Modify: `python/worker/parser_simple.py`
- Modify: `python/worker/parser_docling.py`
- Modify: `python/worker/parser_service.py`
- Test: `python/tests/test_parser_simple.py`
- Test: `python/tests/test_parser_docling.py`
- Test: `python/tests/test_parser_service.py`

**Step 1: Write the failing test**

Add a test asserting the parser service returns typed chunk objects with explicit fields instead of generic dictionaries.

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_parser_simple.py python/tests/test_parser_docling.py python/tests/test_parser_service.py -v`
Expected: FAIL because parser code still returns dictionaries.

**Step 3: Write minimal implementation**

Create parser dataclasses and typed payloads:
- `LocalNode`
- `LocalMount`
- `ParsedChunk`

Update parser modules to accept typed node/mount inputs and return typed chunks internally. Keep any required JSON conversion only at the service boundary if tests still expect serialized dicts.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_parser_simple.py python/tests/test_parser_docling.py python/tests/test_parser_service.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add python/worker/parser/types.py python/worker/parser_simple.py python/worker/parser_docling.py python/worker/parser_service.py python/tests/test_parser_simple.py python/tests/test_parser_docling.py python/tests/test_parser_service.py
git commit -m "refactor: add typed parser domain models"
```

### Task 3: Add vector domain types

**Files:**
- Create: `python/worker/vector/types.py`
- Modify: `python/worker/vector_repository.py`
- Test: `python/tests/test_vector_repository.py`

**Step 1: Write the failing test**

Add a test asserting vector repository methods accept typed vector chunk rows and preserve expected serialized values.

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_vector_repository.py -v`
Expected: FAIL because the repository still expects dictionary rows.

**Step 3: Write minimal implementation**

Create:
- `VectorChunkRow` dataclass
- typed backend protocol

Update repository and in-memory backend code to use the typed row object internally.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_vector_repository.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add python/worker/vector/types.py python/worker/vector_repository.py python/tests/test_vector_repository.py
git commit -m "refactor: add typed vector repository models"
```

### Task 4: Add model domain types

**Files:**
- Create: `python/worker/model/types.py`
- Modify: `python/worker/model_service.py`
- Modify: `python/worker/model_artifacts.py`
- Modify: `python/worker/model_artifact_manager.py`
- Modify: `python/worker/model_runtime_loader.py`
- Test: `python/tests/test_model_artifacts.py`
- Test: `python/tests/test_model_artifact_manager.py`
- Test: `python/tests/test_model_runtime_loader.py`
- Test: `python/tests/test_model_service.py`

**Step 1: Write the failing test**

Add tests that import the new model types and assert:
- runtime config is a typed object
- selected model files are typed objects
- service/load helpers no longer expose broad dictionary configs

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_model_artifacts.py python/tests/test_model_artifact_manager.py python/tests/test_model_runtime_loader.py python/tests/test_model_service.py -v`
Expected: FAIL because typed model objects do not exist yet.

**Step 3: Write minimal implementation**

Create typed model objects for:
- runtime config
- model repo file
- artifact progress
- model task snapshot helpers where appropriate

Replace `dict[str, Any]` model interfaces with typed objects or `TypedDict` payloads.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_model_artifacts.py python/tests/test_model_artifact_manager.py python/tests/test_model_runtime_loader.py python/tests/test_model_service.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add python/worker/model/types.py python/worker/model_service.py python/worker/model_artifacts.py python/worker/model_artifact_manager.py python/worker/model_runtime_loader.py python/tests/test_model_artifacts.py python/tests/test_model_artifact_manager.py python/tests/test_model_runtime_loader.py python/tests/test_model_service.py
git commit -m "refactor: add typed python model domain"
```

### Task 5: Type the status and server boundaries

**Files:**
- Create: `python/worker/runtime/types.py`
- Modify: `python/worker/status.py`
- Modify: `python/worker/server.py`
- Modify: `python/worker/index_queue.py`
- Modify: `python/worker/index_service.py`
- Test: `python/tests/test_status.py`
- Test: `python/tests/test_server.py`
- Test: `python/tests/test_server_model_start.py`
- Test: `python/tests/test_index_queue.py`
- Test: `python/tests/test_index_service.py`

**Step 1: Write the failing test**

Add tests asserting status snapshots and server dispatch helpers expose typed payloads and typed request parsing rather than broad dictionaries.

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_status.py python/tests/test_server.py python/tests/test_server_model_start.py python/tests/test_index_queue.py python/tests/test_index_service.py -v`
Expected: FAIL because typed status/server models are missing.

**Step 3: Write minimal implementation**

Create typed runtime/status payloads and convert:
- status stores
- server request parsing
- server handler params
- index queue snapshots
- index service request/result shapes

Keep raw JSON conversion confined to the protocol layer.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_status.py python/tests/test_server.py python/tests/test_server_model_start.py python/tests/test_index_queue.py python/tests/test_index_service.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add python/worker/runtime/types.py python/worker/status.py python/worker/server.py python/worker/index_queue.py python/worker/index_service.py python/tests/test_status.py python/tests/test_server.py python/tests/test_server_model_start.py python/tests/test_index_queue.py python/tests/test_index_service.py
git commit -m "refactor: type python worker runtime boundaries"
```

### Task 6: Move modules into domain packages

**Files:**
- Create: `python/worker/model/__init__.py`
- Create: `python/worker/parser/__init__.py`
- Create: `python/worker/index/__init__.py`
- Create: `python/worker/vector/__init__.py`
- Create: `python/worker/protocol/__init__.py`
- Create: `python/worker/runtime/__init__.py`
- Move: `python/worker/model_*.py` into `python/worker/model/`
- Move: `python/worker/parser_*.py` into `python/worker/parser/`
- Move: `python/worker/index_*.py` into `python/worker/index/`
- Move: `python/worker/vector_repository.py` into `python/worker/vector/repository.py`
- Move: `python/worker/server.py` and `python/worker/protocol.py` into `python/worker/protocol/`
- Move: `python/worker/status.py` into `python/worker/runtime/status.py`
- Test: affected Python tests updated for new imports

**Step 1: Write the failing test**

Update one representative test file import to the target package path first so it fails on missing modules.

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_server.py -v`
Expected: FAIL due to missing moved module import.

**Step 3: Write minimal implementation**

Move files into domain packages and update imports across runtime code and tests. Add package `__init__.py` files only where needed.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests -v`
Expected: PASS

**Step 5: Commit**

```bash
git add python/worker python/tests
git commit -m "refactor: reorganize python worker modules by domain"
```

### Task 7: Thin the runtime bootstrap entrypoint

**Files:**
- Create: `python/worker/runtime/bootstrap.py`
- Create: `python/worker/runtime/logging.py`
- Modify: `python/worker/__main__.py`
- Test: `python/tests/test_smoke.py`
- Test: `python/tests/test_server.py`
- Test: `python/tests/test_integration_indexing.py`

**Step 1: Write the failing test**

Add a test asserting the worker entrypoint delegates to a bootstrap function instead of constructing the entire graph inline.

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_smoke.py python/tests/test_server.py python/tests/test_integration_indexing.py -v`
Expected: FAIL because bootstrap extraction does not exist yet.

**Step 3: Write minimal implementation**

Extract:
- service graph construction
- event sink wiring
- structured stderr logging helper
- stdio processing loop

Keep `python/worker/__main__.py` as a thin call into the bootstrap layer.

**Step 4: Run test to verify it passes**

Run: `uv run --project python --extra dev pytest python/tests/test_smoke.py python/tests/test_server.py python/tests/test_integration_indexing.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add python/worker/__main__.py python/worker/runtime/bootstrap.py python/worker/runtime/logging.py python/tests/test_smoke.py python/tests/test_server.py python/tests/test_integration_indexing.py
git commit -m "refactor: extract python worker runtime bootstrap"
```

### Task 8: Full verification and docs touch-up

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/plans/2026-03-19-python-worker-module-restructure-design.md` if implementation details shifted

**Step 1: Run focused verification**

Run:

```bash
bun run python:test
bun test src/shared/python-worker.test.ts src/bun/python-worker-runtime.test.ts src/bun/python-worker-command.test.ts
bun run dev
```

Expected:
- Python tests PASS
- Bun worker tests PASS
- dev app starts and worker reaches startup handshake

**Step 2: Update docs if needed**

Adjust README/design notes only if import paths or runtime module descriptions changed materially.

**Step 3: Re-run the minimal affected verification**

Run:

```bash
bun run python:test
bun test src/shared/python-worker.test.ts src/bun/python-worker-runtime.test.ts src/bun/python-worker-command.test.ts
```

Expected: PASS

**Step 4: Commit**

```bash
git add README.md README.zh-CN.md docs/plans/2026-03-19-python-worker-module-restructure-design.md
git commit -m "docs: update python worker module layout notes"
```
