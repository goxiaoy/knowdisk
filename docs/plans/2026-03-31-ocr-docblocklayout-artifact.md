# OCR DocBlockLayout Artifact Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the observed `PP-DocBlockLayout` dependency under the existing OCR artifact manager so `PPStructureV3` stops downloading it through PaddleX defaults.

**Architecture:** Extend the OCR preset expansion to include the additional layout support model, download it alongside the existing det/rec/layout models, record it in `ocr-bundle.json`, and pass its explicit model name and local directory into `PPStructureV3`.

**Tech Stack:** Python, pytest, PaddleOCR runtime glue.

---

### Task 1: Add failing tests for DocBlockLayout bundle support
- Modify: `python/tests/test_image_runtime.py`
- Modify: `python/tests/test_model_artifact_manager.py`
- Modify: `python/tests/test_model_service.py`

1. Add a failing test expecting `PPStructureV3` to receive the explicit DocBlockLayout model name/dir.
2. Add a failing test expecting OCR artifact downloads to include the extra model.
3. Run the targeted tests and verify they fail for the expected missing behavior.

### Task 2: Implement the additional OCR artifact
- Modify: `python/worker/model/types.py`
- Modify: `python/worker/model/artifact_manager.py`
- Modify: `python/worker/model/image_runtime.py`
- Modify: `python/worker/model/artifacts.py`
- Modify: `python/worker/model/model_specs.py`

1. Extend the OCR preset mapping with the DocBlockLayout repo.
2. Download and persist the extra OCR artifact in the bundle manifest.
3. Pass the explicit model name and local dir into `PPStructureV3`.

### Task 3: Verify model service and indexing regressions
- Test: `python/tests/test_model_service.py`
- Test: `python/tests/test_model_runtime_integration.py`
- Test: `python/tests/test_dataset_indexing_integration.py`
- Test: `python/tests/test_integration_indexing.py`

1. Run targeted OCR/model tests.
2. Run nearby indexing regressions to confirm no behavior drift.
