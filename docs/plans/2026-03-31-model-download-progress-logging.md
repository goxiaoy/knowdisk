# Model Download Progress Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Include the current repo file path and local destination path in model download progress logs.

**Architecture:** Extend the artifact-manager progress callback to carry file-level context, then have `ModelService` include that context in its existing `model download progress` logger payload. Keep byte progress semantics unchanged.

**Tech Stack:** Python, pytest.

---

### Task 1: Add failing logging tests
**Files:**
- Modify: `python/tests/test_model_service.py`
- Modify: `python/tests/test_model_artifact_manager.py`

1. Write a failing test that expects `file` and `targetPath` in the logged progress payload.
2. Run the targeted pytest command and confirm it fails.

### Task 2: Implement file-aware progress propagation
**Files:**
- Modify: `python/worker/model/artifact_manager.py`
- Modify: `python/worker/model/service.py`

1. Update the artifact-manager progress callback to include current file metadata.
2. Update `ModelService` progress handling to log those fields.
3. Keep existing progress percentage behavior unchanged.

### Task 3: Verify regressions
**Files:**
- Test: `python/tests/test_model_service.py`
- Test: `python/tests/test_model_artifact_manager.py`
- Test: `python/tests/test_model_runtime_integration.py`

1. Run targeted tests.
2. Run adjacent model service regressions.
