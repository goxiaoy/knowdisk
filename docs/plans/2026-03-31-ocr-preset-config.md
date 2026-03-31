# OCR Preset Config Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify external OCR config to a single preset model string while keeping Python artifact/download logic split across detection, recognition, and layout models.

**Architecture:** TypeScript config, validation, and Python protocol parsing will expose a single OCR preset value `PP-OCRv4_mobile`. Python will resolve that preset through an internal registry into the three concrete Hugging Face repos needed by the OCR runtime. Artifact management and runtime loading remain multi-model internally.

**Tech Stack:** TypeScript config schema/tests, Python worker model config/types, pytest, bun test.

---

### Task 1: Add failing config tests for single OCR preset
**Files:**
- Modify: `packages/core/src/config/default-config.test.ts`
- Modify: `packages/core/src/config/config.types.test.ts`
- Modify: `packages/core/src/config/validate-config.test.ts`
- Modify: `src/shared/python-worker.test.ts`

1. Write failing tests expecting `ocr.local.model` instead of detection/recognition/layout fields.
2. Run targeted tests and verify they fail for the expected schema mismatch.
3. Implement the minimal TS config shape changes.
4. Re-run targeted tests and verify they pass.

### Task 2: Add failing Python tests for OCR preset expansion
**Files:**
- Modify: `python/tests/test_model_types.py`
- Modify: `python/tests/test_protocol.py`
- Modify: `python/tests/test_model_service.py`
- Modify: `python/tests/test_model_artifact_manager.py`

1. Write failing tests expecting `PP-OCRv4_mobile` to expand to the three concrete OCR repos.
2. Run targeted pytest and verify failure.
3. Implement preset registry and mapping in Python config parsing.
4. Re-run targeted pytest and verify pass.

### Task 3: Keep OCR artifact/runtime internals multi-model
**Files:**
- Modify: `python/worker/model/types.py`
- Modify: `python/worker/model/artifact_manager.py`
- Modify: `python/worker/model/service.py`
- Modify: `python/worker/model/image_runtime.py`
- Modify: `python/worker/model/model_specs.py`

1. Ensure internal `ocr_detection_model` / `ocr_recognition_model` / `ocr_layout_model` are still populated from preset expansion.
2. Keep artifact manager and runtime loading unchanged externally but driven from preset-resolved models.
3. Verify bundle naming/logging still works.

### Task 4: Update protocol and end-to-end tests
**Files:**
- Modify: `src/bun/python/status.test.ts`
- Modify: `src/bun/python/runtime.test.ts`
- Modify: `src/bun/python/integration.test.ts`
- Modify: `python/tests/test_server_model_start.py`
- Modify: `python/tests/test_model_runtime_integration.py`
- Modify: `python/tests/test_dataset_indexing_integration.py`
- Modify: `python/tests/test_integration_indexing.py`

1. Update fixtures to pass/expect single OCR preset model.
2. Run targeted Python and Bun suites.
3. Run broader regression suites covering OCR startup and indexing paths.
