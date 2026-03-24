# Image Multimodal Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a dedicated parser-layer image pipeline that uses PaddleOCR and Moondream to build multimodal chunks, with all image models configured in `CoreConfig` and managed through the Python model/artifact stack.

**Architecture:** Image files will be routed away from Docling in `parse_node(...)` and into a dedicated `parse_image_document(...)` pipeline. Bun will pass the Python-relevant config subset into startup, while Python will extend `ModelService` and `ModelArtifactManager` to manage OCR and caption models using the same verified-runtime contract already used for embedding and reranker.

**Tech Stack:** Bun, TypeScript, Python, pytest, Bun test, PaddleOCR, Moondream, Hugging Face artifact downloads

---

### Task 1: Extend config and startup protocol for image models

**Files:**
- Modify: `packages/core/src/config/config.types.ts`
- Modify: `packages/core/src/config/default-config.ts`
- Modify: `packages/core/src/config/default-config.test.ts`
- Modify: `packages/core/src/config/validate-config.ts`
- Modify: `packages/core/src/config/validate-config.test.ts`
- Modify: `src/shared/python-worker.ts`
- Modify: `src/shared/python-worker.test.ts`
- Modify: `src/bun/python/startup-config.ts`
- Modify: `src/bun/python/startup-config.test.ts`
- Modify: `python/worker/protocol/types.py`
- Modify: `python/worker/protocol/frames.py`
- Modify: `python/tests/test_protocol.py`

**Step 1: Write the failing test**

Add assertions that:

- `CoreConfig` includes `ocr` and `caption` local-model settings
- validation requires local model config for those providers
- Python startup payload accepts the config subset carrying `ocr`, `caption`, and Hugging Face settings
- Bun startup mapping forwards the new config fields

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/config/default-config.test.ts packages/core/src/config/validate-config.test.ts src/shared/python-worker.test.ts src/bun/python/startup-config.test.ts`

Run: `uv run --project python --extra dev pytest python/tests/test_protocol.py -v`

Expected: FAIL until config types, defaults, validation, and startup protocol are updated.

**Step 3: Write minimal implementation**

Update config types/defaults/validation and extend the Bun-Python startup payload to carry the image-model config subset.

**Step 4: Run test to verify it passes**

Run the same commands from Step 2.

Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/config/config.types.ts packages/core/src/config/default-config.ts packages/core/src/config/default-config.test.ts packages/core/src/config/validate-config.ts packages/core/src/config/validate-config.test.ts src/shared/python-worker.ts src/shared/python-worker.test.ts src/bun/python/startup-config.ts src/bun/python/startup-config.test.ts python/worker/protocol/types.py python/worker/protocol/frames.py python/tests/test_protocol.py
git commit -m "feat: add image model startup config"
```

### Task 2: Extend Python model/artifact management for OCR and caption runtimes

**Files:**
- Modify: `python/worker/model/types.py`
- Modify: `python/worker/model/artifacts.py`
- Modify: `python/worker/model/artifact_manager.py`
- Modify: `python/worker/model/service.py`
- Modify: `python/worker/runtime/bootstrap.py`
- Test: `python/tests/test_model_artifacts.py`
- Test: `python/tests/test_model_service.py`
- Test: `python/tests/test_model_types.py`

**Step 1: Write the failing test**

Add tests that:

- OCR and caption artifact file selectors keep the required files
- local completeness checks work for OCR and caption
- `ModelService` can verify and expose OCR/caption runtimes
- startup config can carry OCR/caption model ids into Python runtime config

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_model_artifacts.py python/tests/test_model_service.py python/tests/test_model_types.py -v`

Expected: FAIL because OCR/caption kinds do not exist yet.

**Step 3: Write minimal implementation**

Add OCR/caption model kinds, artifact selection logic, completeness checks, and verified runtime acquisition paths in `ModelService`.

**Step 4: Run test to verify it passes**

Run the same command from Step 2.

Expected: PASS

**Step 5: Commit**

```bash
git add python/worker/model/types.py python/worker/model/artifacts.py python/worker/model/artifact_manager.py python/worker/model/service.py python/worker/runtime/bootstrap.py python/tests/test_model_artifacts.py python/tests/test_model_service.py python/tests/test_model_types.py
git commit -m "feat: manage ocr and caption runtimes"
```

### Task 3: Add the parser-layer image pipeline

**Files:**
- Create: `python/worker/parser/image_pipeline.py`
- Modify: `python/worker/parser/service.py`
- Modify: `python/worker/parser/types.py`
- Test: `python/tests/test_parser_service.py`
- Create: `python/tests/test_parser_image_pipeline.py`

**Step 1: Write the failing test**

Add tests that:

- image suffixes no longer route to Docling
- image inputs route to `parse_image_document(...)`
- multimodal chunk text includes caption, OCR text, and compact metadata
- OCR/caption failures return parser error chunks

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_parser_service.py python/tests/test_parser_image_pipeline.py -v`

Expected: FAIL because the dedicated image pipeline does not exist yet.

**Step 3: Write minimal implementation**

Implement `parse_image_document(...)`, wire image suffix routing in `parse_node(...)`, and return a single multimodal chunk per image.

**Step 4: Run test to verify it passes**

Run the same command from Step 2.

Expected: PASS

**Step 5: Commit**

```bash
git add python/worker/parser/image_pipeline.py python/worker/parser/service.py python/worker/parser/types.py python/tests/test_parser_service.py python/tests/test_parser_image_pipeline.py
git commit -m "feat: add multimodal image parser pipeline"
```

### Task 4: Integrate image chunks with end-to-end indexing

**Files:**
- Modify: `python/tests/test_integration_indexing.py`
- Modify: `python/tests/test_dataset_indexing_integration.py`
- Modify: `src/bun/python/integration.test.ts`

**Step 1: Write the failing test**

Add integration assertions that:

- image chunks are indexed and searchable
- image parser artifacts are written
- startup config propagation still works end-to-end from Bun into Python

**Step 2: Run test to verify it fails**

Run: `uv run --project python --extra dev pytest python/tests/test_integration_indexing.py python/tests/test_dataset_indexing_integration.py -v`

Run: `bun test src/bun/python/integration.test.ts`

Expected: FAIL until the parser/model/image runtime stack is fully integrated.

**Step 3: Write minimal implementation**

Wire the image parser path into the existing indexing flow and update Bun-side integration fixtures as needed.

**Step 4: Run test to verify it passes**

Run the same commands from Step 2.

Expected: PASS

**Step 5: Commit**

```bash
git add python/tests/test_integration_indexing.py python/tests/test_dataset_indexing_integration.py src/bun/python/integration.test.ts
git commit -m "test: cover image multimodal indexing flow"
```
