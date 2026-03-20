# Python Model Runtime Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the placeholder Python `model_service.py` with a real Python-owned model runtime that supports Bun-provided model selection, resumable downloads, verify-by-load, and local embedding/reranker loading without relying on ONNX as the default backend.

**Architecture:** Bun remains the orchestration layer and passes runtime configuration during worker startup. Python owns model download, local cache management, device selection, verification, runtime loading, and status emission.

**Tech Stack:** Bun, TypeScript, Bun test, Python 3, `pytest`, `sentence-transformers`, `transformers`, Hugging Face HTTP APIs, resumable file downloads, local cache directories

---

### Task 1: Extend the worker start contract for model runtime configuration

**Files:**
- Modify: `src/shared/python-worker.ts`
- Modify: `src/shared/python-worker.test.ts`
- Modify: `python/tests/test_protocol.py`

**Step 1: Write the failing tests**

Add contract coverage for a `start` payload carrying:

- `embeddingModel`
- `rerankerModel`
- `preferredDevice`
- `modelCacheDir`
- optional `huggingfaceEndpoint`

Assert invalid or incomplete startup payloads are rejected by the shared guards.

**Step 2: Run tests to verify they fail**

Run:

- `bun test src/shared/python-worker.test.ts`
- `uv run --project python --extra dev pytest python/tests/test_protocol.py -v`

Expected: FAIL because the contract does not yet define these startup fields.

**Step 3: Write minimal implementation**

Update the shared worker contract types so the `start` request shape includes model runtime configuration fields.

**Step 4: Run tests to verify they pass**

Run the same commands as step 2.

**Step 5: Commit**

```bash
git add src/shared/python-worker.ts src/shared/python-worker.test.ts python/tests/test_protocol.py
git commit -m "feat: extend worker start payload for model runtime"
```

### Task 2: Add Python runtime config parsing and validation

**Files:**
- Modify: `python/worker/server.py`
- Create: `python/tests/test_server_model_start.py`

**Step 1: Write the failing tests**

Add tests covering:

- worker `start` stores model runtime config
- missing required model config fails startup
- invalid preferred device fails startup

**Step 2: Run test to verify it fails**

Run:

- `uv run --project python --extra dev pytest python/tests/test_server_model_start.py -v`

Expected: FAIL because the server does not validate or store this config yet.

**Step 3: Write minimal implementation**

Add runtime config parsing and validation to the Python worker startup path. Keep storage local to the server for now.

**Step 4: Run test to verify it passes**

Run the same command as step 2.

**Step 5: Commit**

```bash
git add python/worker/server.py python/tests/test_server_model_start.py
git commit -m "feat: validate python model runtime config on start"
```

### Task 3: Add model artifact selection rules for transformer-based models

**Files:**
- Create: `python/worker/model_artifacts.py`
- Create: `python/tests/test_model_artifacts.py`

**Step 1: Write the failing test**

Add tests for selecting required files from a Hugging Face repo listing for:

- sentence-transformer embedding model files
- reranker transformer model files
- ignoring unrelated files

**Step 2: Run test to verify it fails**

Run:

- `uv run --project python --extra dev pytest python/tests/test_model_artifacts.py -v`

Expected: FAIL because the artifact selection module does not exist.

**Step 3: Write minimal implementation**

Implement file selection helpers for embedding and reranker artifacts without any ONNX assumptions.

**Step 4: Run test to verify it passes**

Run the same command as step 2.

**Step 5: Commit**

```bash
git add python/worker/model_artifacts.py python/tests/test_model_artifacts.py
git commit -m "feat: add transformer model artifact selection"
```

### Task 4: Add resumable file download primitives

**Files:**
- Create: `python/worker/model_download.py`
- Create: `python/tests/test_model_download.py`

**Step 1: Write the failing tests**

Add tests covering:

- downloading a file to a `.part` path then promoting it
- resuming from an existing partial file using range headers
- aggregating downloaded bytes into progress

Use fake HTTP clients in tests. Do not depend on the network.

**Step 2: Run test to verify it fails**

Run:

- `uv run --project python --extra dev pytest python/tests/test_model_download.py -v`

Expected: FAIL because the downloader module does not exist.

**Step 3: Write minimal implementation**

Implement resumable download helpers with `.part` files and range request support.

**Step 4: Run test to verify it passes**

Run the same command as step 2.

**Step 5: Commit**

```bash
git add python/worker/model_download.py python/tests/test_model_download.py
git commit -m "feat: add resumable model download primitives"
```

### Task 5: Add the Python model artifact manager

**Files:**
- Create: `python/worker/model_artifact_manager.py`
- Create: `python/tests/test_model_artifact_manager.py`

**Step 1: Write the failing tests**

Add tests covering:

- listing model files from the configured endpoint
- downloading all required files into the correct cache directory
- preserving partial downloads for resume
- replacing damaged local state when re-download is requested

**Step 2: Run test to verify it fails**

Run:

- `uv run --project python --extra dev pytest python/tests/test_model_artifact_manager.py -v`

Expected: FAIL because the artifact manager does not exist.

**Step 3: Write minimal implementation**

Implement a `ModelArtifactManager` that:

- resolves cache directories by task kind and repo id
- fetches repository listings
- selects required files
- downloads them with progress callbacks

Keep verification out of this layer.

**Step 4: Run test to verify it passes**

Run the same command as step 2.

**Step 5: Commit**

```bash
git add python/worker/model_artifact_manager.py python/tests/test_model_artifact_manager.py
git commit -m "feat: add python model artifact manager"
```

### Task 6: Add device selection and local runtime loaders

**Files:**
- Create: `python/worker/model_runtime_loader.py`
- Create: `python/tests/test_model_runtime_loader.py`
- Modify: `python/pyproject.toml`

**Step 1: Write the failing tests**

Add tests covering:

- `cuda` preference resolves to `cuda` when available
- `mps` preference resolves to `mps` when available
- fallback to `cpu`
- successful local embedding load
- successful local reranker load
- load failure propagates verification errors

Use injected runtime loader fakes in tests.

**Step 2: Run test to verify it fails**

Run:

- `uv run --project python --extra dev pytest python/tests/test_model_runtime_loader.py -v`

Expected: FAIL because the runtime loader does not exist.

**Step 3: Write minimal implementation**

Implement:

- device selection helper
- local embedding loader using `sentence-transformers`
- local reranker loader using `transformers`

Update `python/pyproject.toml` with the runtime dependencies required for these modules.

**Step 4: Run test to verify it passes**

Run the same command as step 2.

**Step 5: Commit**

```bash
git add python/worker/model_runtime_loader.py python/tests/test_model_runtime_loader.py python/pyproject.toml
git commit -m "feat: add python model runtime loader"
```

### Task 7: Replace the placeholder Python model service with a real implementation

**Files:**
- Modify: `python/worker/model_service.py`
- Modify: `python/tests/test_model_service.py`

**Step 1: Write the failing tests**

Expand model service tests to cover:

- verify existing local model by successful load
- download missing model and update progress
- mark task `failed` when verify-by-load fails
- cache and return loaded embedding runtime
- cache and return loaded reranker runtime

**Step 2: Run test to verify it fails**

Run:

- `uv run --project python --extra dev pytest python/tests/test_model_service.py -v`

Expected: FAIL because the current service is only a placeholder.

**Step 3: Write minimal implementation**

Rework `ModelService` so it coordinates:

- runtime config
- artifact manager
- runtime loader
- model status store

The service should implement verify-by-load as the source of truth for model validity.

**Step 4: Run test to verify it passes**

Run the same command as step 2.

**Step 5: Commit**

```bash
git add python/worker/model_service.py python/tests/test_model_service.py
git commit -m "feat: implement python model service"
```

### Task 8: Wire model config from Bun into worker startup

**Files:**
- Modify: `src/bun/index.ts`
- Modify: `src/bun/python-worker-runtime.ts`
- Modify: `src/bun/python-worker-runtime.test.ts`

**Step 1: Write the failing tests**

Add Bun-side tests covering:

- worker `start` request includes embedding model
- worker `start` request includes reranker model
- worker `start` request includes preferred device and model cache dir

**Step 2: Run test to verify it fails**

Run:

- `bun test src/bun/python-worker-runtime.test.ts`

Expected: FAIL because Bun does not yet pass the new runtime config.

**Step 3: Write minimal implementation**

Update Bun worker startup so it sends model runtime configuration during `start`.

Use Bun as the source of defaults for:

- `Alibaba-NLP/gte-multilingual-base`
- `Alibaba-NLP/gte-multilingual-reranker-base`

**Step 4: Run test to verify it passes**

Run the same command as step 2.

**Step 5: Commit**

```bash
git add src/bun/index.ts src/bun/python-worker-runtime.ts src/bun/python-worker-runtime.test.ts
git commit -m "feat: pass model runtime config to python worker"
```

### Task 9: Add focused integration coverage for the Python model runtime

**Files:**
- Create: `python/tests/test_model_runtime_integration.py`

**Step 1: Write the failing test**

Add integration tests using stub downloader and loader components to verify:

- local-cache verify path
- missing-cache download path
- failed-load path
- final model status transitions

**Step 2: Run test to verify it fails**

Run:

- `uv run --project python --extra dev pytest python/tests/test_model_runtime_integration.py -v`

Expected: FAIL because the new integration coverage does not exist.

**Step 3: Write minimal implementation**

Add the test and any small supporting seams needed to make the runtime injectable.

**Step 4: Run test to verify it passes**

Run the same command as step 2.

**Step 5: Commit**

```bash
git add python/tests/test_model_runtime_integration.py
git commit -m "test: add python model runtime integration coverage"
```

### Task 10: Run verification and document runtime requirements

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/plans/2026-03-17-python-model-runtime-design.md`

**Step 1: Run verification**

Run:

- `bun run python:test`
- `bun test src/shared/python-worker.test.ts src/bun/python-worker-runtime.test.ts`

If the repo baseline still has unrelated failures, record only the scoped passing commands.

**Step 2: Update docs**

Document:

- the Bun-provided default models
- required Python runtime dependencies
- current supported device targets
- the fact that Python no longer uses ONNX as the default local backend

**Step 3: Commit**

```bash
git add README.md README.zh-CN.md docs/plans/2026-03-17-python-model-runtime-design.md
git commit -m "docs: add python model runtime requirements"
```
