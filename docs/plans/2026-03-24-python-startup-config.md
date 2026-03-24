# Python Startup Config Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Derive Python worker startup settings from `CoreConfig`, align default local model ids with current Python expectations, and pass only the Python-relevant config subset to Python.

**Architecture:** Bun remains the owner of `CoreConfig`. A focused mapper converts `CoreConfig` into Python startup params, so `src/bun/index.ts` stops hard-coding model ids and Python receives a stable, explicit subset of app config without depending on the full config shape.

**Tech Stack:** Bun, TypeScript, `bun test`

---

### Task 1: Express the intended startup payload in tests

**Files:**
- Modify: `packages/core/src/config/default-config.test.ts`
- Modify: `src/shared/python-worker.test.ts`
- Create: `src/bun/python/startup-config.test.ts`

**Step 1: Write the failing test**

Add assertions that:
- default local embedding/reranker models match the Python runtime model ids
- Python worker start params accept an optional minimal `coreConfig` subset
- Bun startup config mapping derives embedding, reranker, and Hugging Face endpoint from `CoreConfig`

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/config/default-config.test.ts src/shared/python-worker.test.ts src/bun/python/startup-config.test.ts`

Expected: FAIL because defaults and startup mapping are not aligned yet.

**Step 3: Write minimal implementation**

Update config defaults, shared worker types, and add the startup mapping helper.

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/config/default-config.test.ts src/shared/python-worker.test.ts src/bun/python/startup-config.test.ts`

Expected: PASS

### Task 2: Replace Bun hard-coded Python startup config

**Files:**
- Modify: `src/bun/index.ts`
- Modify: `src/bun/python/runtime.ts`
- Modify: `src/bun/python/runtime.test.ts`

**Step 1: Write the failing test**

Adjust runtime-related tests to expect the mapped startup payload, including the optional config subset.

**Step 2: Run test to verify it fails**

Run: `bun test src/bun/python/runtime.test.ts src/bun/python/integration.test.ts`

Expected: FAIL until Bun startup config and runtime types are updated.

**Step 3: Write minimal implementation**

Use the new mapper in `src/bun/index.ts` and extend runtime start config typing to carry the optional config subset through transport.

**Step 4: Run test to verify it passes**

Run: `bun test src/bun/python/runtime.test.ts src/bun/python/integration.test.ts src/bun/index.ts`

Expected: PASS for the test files; `src/bun/index.ts` is referenced for implementation context only.
