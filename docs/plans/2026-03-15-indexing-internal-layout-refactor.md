# Indexing Internal Layout Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize `packages/indexing/src` into `embedding/`, `rerank/`, `fts/`, and `vector/` folders without changing the public API of `@knowdisk/indexing`.

**Architecture:** Keep service/types tests at package root, move registry/repository code and their tests into feature folders, and use folder-local `index.ts` re-exports so the package root can preserve the same public surface. Treat this as a pure internal refactor with test-first verification.

**Tech Stack:** Bun, TypeScript, existing `bun:test` suite, workspace package `@knowdisk/indexing`

---

### Task 1: Lock Public API and Move Embedding/Rerank Files

**Files:**
- Modify: `packages/indexing/src/indexing.package.test.ts`
- Create: `packages/indexing/src/embedding/index.ts`
- Create: `packages/indexing/src/rerank/index.ts`
- Move: `packages/indexing/src/embedding.registry.ts`
- Move: `packages/indexing/src/embedding.registry.test.ts`
- Move: `packages/indexing/src/reranker.registry.ts`
- Move: `packages/indexing/src/reranker.registry.test.ts`
- Modify: `packages/indexing/src/index.ts`

**Step 1: Write the failing test**

Extend the package entry test to assert `createEmbeddingRegistry` and `createRerankerRegistry` still resolve through `@knowdisk/indexing` after internal folder moves.

**Step 2: Run test to verify it fails**

Run: `bun test packages/indexing/src/indexing.package.test.ts`
Expected: FAIL after import paths are changed but before re-exports are repaired.

**Step 3: Write minimal implementation**

Move embedding/rerank registry files into feature folders, add folder `index.ts` files, and update package root exports to point at the new locations.

**Step 4: Run test to verify it passes**

Run: `bun test packages/indexing/src/indexing.package.test.ts packages/indexing/src/embedding packages/indexing/src/rerank`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src
git commit -m "refactor(indexing): group embedding and rerank modules"
```

### Task 2: Move FTS/Vector Files Into Feature Folders

**Files:**
- Create: `packages/indexing/src/fts/index.ts`
- Create: `packages/indexing/src/vector/index.ts`
- Move: `packages/indexing/src/fts.repository.ts`
- Move: `packages/indexing/src/fts.repository.types.ts`
- Move: `packages/indexing/src/fts.repository.test.ts`
- Move: `packages/indexing/src/vector.repository.ts`
- Move: `packages/indexing/src/vector.repository.types.ts`
- Move: `packages/indexing/src/vector.repository.test.ts`
- Modify: `packages/indexing/src/index.ts`
- Modify: `packages/indexing/src/indexing.e2e.test.ts`

**Step 1: Write the failing test**

Use existing package and e2e tests as the guard that root exports still resolve while internal repository files move.

**Step 2: Run test to verify it fails**

Run: `bun test packages/indexing/src/indexing.e2e.test.ts packages/indexing/src/indexing.package.test.ts`
Expected: FAIL until moved repository paths are re-exported correctly.

**Step 3: Write minimal implementation**

Move FTS/vector repository files into feature folders, add folder `index.ts` files, and update internal imports in root index and e2e test.

**Step 4: Run test to verify it passes**

Run: `bun test packages/indexing/src/indexing.e2e.test.ts packages/indexing/src/fts packages/indexing/src/vector`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src
git commit -m "refactor(indexing): group fts and vector modules"
```

### Task 3: Run Full Verification

**Files:**
- Modify: `packages/indexing/src/index.ts`
- Test: `packages/indexing/src`

**Step 1: Run focused package suite**

Run: `bun test packages/indexing/src`
Expected: PASS with zero failures.

**Step 2: Run workspace regression checks**

Run: `bun test packages/parser/src packages/vfs/src packages/indexing/src`
Expected: PASS with zero failures.

**Step 3: Final export cleanup**

Ensure `packages/indexing/src/index.ts` still exposes the same public API and no moved internal file leaks through path-specific imports.

**Step 4: Re-run verification**

Run: `bun test packages/indexing/src`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src
git commit -m "chore(indexing): verify internal layout refactor"
```
