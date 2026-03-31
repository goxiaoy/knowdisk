# Desktop OCR Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the default desktop OCR runtime with a lightweight `PP-OCRv4 mobile + PP-Structure` pipeline, keep `vikhyatk/moondream2` for captioning, and remove `PaddleOCR-VL` from the default local OCR path.

**Architecture:** The Python worker will stop treating OCR as a multimodal generation task. Instead it will load a dedicated OCR runtime and a layout runtime, normalize both into document blocks, and pass structured text into the existing image parsing flow while caption generation remains on `moondream2`.

**Tech Stack:** Python worker, local model artifact manager, Paddle-style OCR/layout runtime wrappers, pytest.

---

### Task 1: Lock the new default OCR model contract

**Files:**
- Modify: `python/worker/model/types.py`
- Modify: `python/tests/test_model_types.py`
- Modify: `python/tests/test_server_model_start.py`
- Modify: `python/tests/test_protocol.py`

**Step 1: Write the failing tests**

Add assertions that the default OCR model is no longer `PaddlePaddle/PaddleOCR-VL` and that start/config plumbing preserves the new OCR model id while still keeping `vikhyatk/moondream2` for caption.

**Step 2: Run test to verify it fails**

Run: `uv run --project python pytest python/tests/test_model_types.py python/tests/test_server_model_start.py python/tests/test_protocol.py -q`
Expected: FAIL because runtime config and protocol fixtures still reference `PaddlePaddle/PaddleOCR-VL`.

**Step 3: Write minimal implementation**

Update the runtime-config fallback and start/protocol fixtures to the new OCR model id.

**Step 4: Run test to verify it passes**

Run: `uv run --project python pytest python/tests/test_model_types.py python/tests/test_server_model_start.py python/tests/test_protocol.py -q`
Expected: PASS.

### Task 2: Replace the OCR runtime contract

**Files:**
- Modify: `python/worker/model/image_runtime.py`
- Modify: `python/worker/model/types.py`
- Modify: `python/worker/runtime/bootstrap.py`
- Modify: `python/tests/test_image_runtime.py`

**Step 1: Write the failing tests**

Add tests that describe the new OCR runtime behavior:
- OCR runtime no longer uses `AutoModelForCausalLM`/`AutoProcessor`
- OCR analysis returns normalized text/regions from a lightweight OCR pipeline
- `moondream2` caption loading and caption analysis remain unchanged

**Step 2: Run test to verify it fails**

Run: `uv run --project python pytest python/tests/test_image_runtime.py -q`
Expected: FAIL because the current implementation is still `PaddleOCR-VL`-specific.

**Step 3: Write minimal implementation**

Introduce dedicated OCR/layout runtime loaders and a normalized OCR analyze function; update bootstrap to call the new OCR analyzer and stop importing the `PaddleOCR-VL`-specific entrypoint.

**Step 4: Run test to verify it passes**

Run: `uv run --project python pytest python/tests/test_image_runtime.py -q`
Expected: PASS.

### Task 3: Update model artifact declarations

**Files:**
- Modify: `python/worker/model/model_specs.py`
- Modify: `python/worker/model/artifacts.py`
- Modify: `python/worker/model/artifact_manager.py`
- Modify: `python/worker/model/service.py`
- Modify: `python/tests/test_model_artifacts.py`
- Modify: `python/tests/test_model_artifact_manager.py`
- Modify: `python/tests/test_model_service.py`

**Step 1: Write the failing tests**

Add assertions for the new OCR model artifact declaration and remove the assumption that `PaddleOCR-VL` is the default OCR repo.

**Step 2: Run test to verify it fails**

Run: `uv run --project python pytest python/tests/test_model_artifacts.py python/tests/test_model_artifact_manager.py python/tests/test_model_service.py -q`
Expected: FAIL because artifact selection still centers on `PaddleOCR-VL`.

**Step 3: Write minimal implementation**

Add model declarations for the lightweight OCR/layout pipeline, switch OCR defaults to the new model id, and keep `moondream2` caption-specific rules intact.

**Step 4: Run test to verify it passes**

Run: `uv run --project python pytest python/tests/test_model_artifacts.py python/tests/test_model_artifact_manager.py python/tests/test_model_service.py -q`
Expected: PASS.

### Task 4: Remove stale default-path references and run integration checks

**Files:**
- Modify: `python/tests/test_model_runtime_integration.py`
- Modify: `python/tests/test_integration_indexing.py`
- Modify: `python/tests/test_dataset_indexing_integration.py`
- Modify: `src/bun/python/runtime.test.ts`
- Modify: `src/bun/python/integration.test.ts`
- Modify: `src/bun/python/status.test.ts`
- Modify: `src/shared/python-worker.test.ts`
- Modify: `src/renderer/components/shell/status-indicator.test.tsx`

**Step 1: Write the failing tests**

Update test fixtures and expectations that still hardcode `PaddlePaddle/PaddleOCR-VL` as the default OCR model.

**Step 2: Run test to verify it fails**

Run: `uv run --project python pytest python/tests/test_model_runtime_integration.py python/tests/test_integration_indexing.py python/tests/test_dataset_indexing_integration.py -q`
Expected: FAIL until the defaults and runtime wiring are consistent.

**Step 3: Write minimal implementation**

Adjust all remaining test and status fixtures to the new OCR model naming and runtime behavior.

**Step 4: Run test to verify it passes**

Run: `uv run --project python pytest python/tests/test_model_runtime_integration.py python/tests/test_integration_indexing.py python/tests/test_dataset_indexing_integration.py -q`
Expected: PASS.
