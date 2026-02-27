# VFS Monorepo Package Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract the entire `src/core/vfs` directory into a Bun workspace package and consume it from the app via `@knowdisk/vfs`.

**Architecture:** Introduce Bun workspaces at repo root and add `packages/vfs` as a source-first package exporting all VFS modules through `src/index.ts`. Update runtime and view-layer imports to use package exports. Keep behavior unchanged and validate with existing VFS + app tests.

**Tech Stack:** Bun workspaces, TypeScript, Bun test.

---

### Task 1: Workspace bootstrap and package contract

**Files:**
- Modify: `package.json`
- Create: `packages/vfs/package.json`
- Create: `packages/vfs/src/index.ts`
- Test: `src/core/vfs.workspace.test.ts`

**Step 1:** Write failing test importing `@knowdisk/vfs`.
**Step 2:** Run test and verify it fails (module not found).
**Step 3:** Add Bun workspace config and VFS package manifest/index exports.
**Step 4:** Run test and verify it passes.
**Step 5:** Commit.

### Task 2: Move full VFS directory into package and fix imports

**Files:**
- Move: `src/core/vfs/*` -> `packages/vfs/src/*`
- Modify: `src/bun/app.container.ts`
- Modify: `src/bun/index.ts`
- Modify: `src/mainview/services/bun.rpc.ts`

**Step 1:** Run selected existing VFS tests before import updates and verify failure.
**Step 2:** Update imports to package exports.
**Step 3:** Fix package-internal relative imports after move.
**Step 4:** Run VFS and app tests to verify pass.
**Step 5:** Commit.

### Task 3: Verification and docs sync

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Step 1:** Add monorepo/package location notes.
**Step 2:** Run `bun test` full suite.
**Step 3:** Commit.
