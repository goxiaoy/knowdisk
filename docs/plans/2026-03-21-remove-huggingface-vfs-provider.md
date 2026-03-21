# Remove Hugging Face VFS Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the Hugging Face VFS provider from `packages/vfs` and clean all package-local references.

**Architecture:** `packages/vfs` will retain only the local built-in provider. Registry, example app, and integration tests will be updated to stop depending on Hugging Face-specific behavior before the provider source is deleted.

**Tech Stack:** Bun, TypeScript, `bun test`

---

### Task 1: Update package-local tests to the new built-in provider set

**Files:**
- Modify: `packages/vfs/src/vfs.provider.registry.test.ts`
- Modify: `packages/vfs/src/vfs.syncer.integration.test.ts`
- Modify: `packages/vfs/example/app.test.ts`

**Step 1: Write the failing test**

Adjust expectations so built-in providers only include `local`, remove Hugging Face-specific assertions, and make the example app assert a single local mount.

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/vfs.provider.registry.test.ts packages/vfs/src/vfs.syncer.integration.test.ts packages/vfs/example/app.test.ts`

Expected: FAIL because production code still registers or depends on Hugging Face.

**Step 3: Write minimal implementation**

Remove Hugging Face registration and example mounting code.

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.provider.registry.test.ts packages/vfs/src/vfs.syncer.integration.test.ts packages/vfs/example/app.test.ts`

Expected: PASS

### Task 2: Delete provider implementation and direct package references

**Files:**
- Modify: `packages/vfs/src/provider/index.ts`
- Delete: `packages/vfs/src/provider/huggingface/index.ts`
- Delete: `packages/vfs/src/provider/huggingface/huggingface.provider.test.ts`
- Delete: `packages/vfs/src/provider/huggingface/huggingface.provider.integration.test.ts`

**Step 1: Write the failing test**

Use the updated package-local tests from Task 1 as the active regression suite.

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/vfs.provider.registry.test.ts packages/vfs/src/vfs.syncer.integration.test.ts packages/vfs/example/app.test.ts`

Expected: FAIL until production references are removed.

**Step 3: Write minimal implementation**

Delete the provider directory and remove imports/exports from the provider barrel.

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.provider.registry.test.ts packages/vfs/src/vfs.syncer.integration.test.ts packages/vfs/example/app.test.ts`

Expected: PASS
