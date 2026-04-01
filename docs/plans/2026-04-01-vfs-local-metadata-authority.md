# VFS Local Metadata Authority Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make VFS the sole authority for provider metadata by removing `syncMetadata` and making browse always read from the local repository.

**Architecture:** The VFS service will stop fetching provider pages during `walkChildren`. Providers remain synchronization inputs for reconcile and watch flows, while the repository becomes the only browse source. Schema and public mount config are simplified to retain only `syncContent` as the metadata/content toggle.

**Tech Stack:** Bun, TypeScript, SQLite-backed repository, provider adapters, Bun test

---

### Task 1: Remove `syncMetadata` from shared VFS types

**Files:**
- Modify: `packages/vfs/src/vfs.types.ts`
- Modify: `packages/vfs/src/vfs.repository.types.ts`
- Test: `packages/vfs/src/vfs.types.test.ts`

**Step 1: Write the failing test**

Add or adjust a type-focused test so mount fixtures no longer include `syncMetadata`.

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/vfs.types.test.ts`
Expected: FAIL or type/test mismatch because the code still expects `syncMetadata`

**Step 3: Write minimal implementation**

Remove `syncMetadata` from `VfsMountConfig`, `VfsMount`, and repository row types. If `WalkChildrenOutput.source` still exposes `"remote"`, simplify it to local-only semantics.

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/vfs/src/vfs.types.ts packages/vfs/src/vfs.repository.types.ts packages/vfs/src/vfs.types.test.ts
git commit -m "refactor(vfs): remove syncMetadata from types"
```

### Task 2: Remove `syncMetadata` from repository persistence and schema

**Files:**
- Modify: `packages/vfs/src/vfs.repository.ts`
- Modify: `packages/vfs/src/vfs.repository.test.ts`

**Step 1: Write the failing test**

Update repository tests to construct mount ext rows without `syncMetadata` and assert read/write still round-trip correctly.

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/vfs.repository.test.ts`
Expected: FAIL because SQL queries and row mapping still require `sync_metadata`

**Step 3: Write minimal implementation**

Remove the `sync_metadata` column from inserts, selects, row mapping, and schema creation. Keep destructive schema assumptions simple; no migration compatibility is required.

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.repository.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/vfs/src/vfs.repository.ts packages/vfs/src/vfs.repository.test.ts
git commit -m "refactor(vfs): remove syncMetadata from repository"
```

### Task 3: Make `walkChildren` local-authoritative only

**Files:**
- Modify: `packages/vfs/src/vfs.service.ts`
- Modify: `packages/vfs/src/vfs.service.walk.test.ts`
- Test: `packages/vfs/src/vfs.integration.test.ts`

**Step 1: Write the failing test**

Replace remote-browse tests with assertions that:
- unsynced mounts return empty local results
- `walkChildren` never calls provider `listChildren`
- existing local rows are returned for every mount

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/vfs.service.walk.test.ts packages/vfs/src/vfs.integration.test.ts`
Expected: FAIL because the service still uses the remote branch for some mounts

**Step 3: Write minimal implementation**

Delete the remote browse branch and make `walkChildren` always call `walkLocalChildren`. Remove remote cursor decoding and any now-unused imports/helpers in the service.

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.service.walk.test.ts packages/vfs/src/vfs.integration.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/vfs/src/vfs.service.ts packages/vfs/src/vfs.service.walk.test.ts packages/vfs/src/vfs.integration.test.ts
git commit -m "refactor(vfs): make local metadata authoritative"
```

### Task 4: Remove obsolete remote page-cache behavior

**Files:**
- Modify: `packages/vfs/src/vfs.repository.ts`
- Modify: `packages/vfs/src/vfs.repository.types.ts`
- Modify: `packages/vfs/src/vfs.service.ts`
- Modify: `packages/vfs/src/vfs.cursor.ts`
- Modify: `packages/vfs/src/vfs.cursor.test.ts`

**Step 1: Write the failing test**

Adjust cursor tests so remote cursor handling is no longer required if it becomes dead code.

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/vfs.cursor.test.ts`
Expected: FAIL because remote cursor/page-cache code still exists or is still referenced

**Step 3: Write minimal implementation**

Delete remote page-cache and cursor code that is no longer reachable after Task 3. Keep only the local cursor path required for local pagination.

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.cursor.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/vfs/src/vfs.repository.ts packages/vfs/src/vfs.repository.types.ts packages/vfs/src/vfs.service.ts packages/vfs/src/vfs.cursor.ts packages/vfs/src/vfs.cursor.test.ts
git commit -m "refactor(vfs): remove remote browse cache"
```

### Task 5: Update sync pipeline and examples to the simplified mount model

**Files:**
- Modify: `packages/vfs/src/vfs.syncer.ts`
- Modify: `packages/vfs/src/vfs.node-event-processor.ts`
- Modify: `packages/vfs/src/vfs.integration.test.ts`
- Modify: `packages/vfs/example/app.ts`
- Modify: `packages/vfs/src/provider/local/local.provider.test.ts`

**Step 1: Write the failing test**

Update fixtures and examples that still construct mounts with `syncMetadata`.

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/vfs.integration.test.ts packages/vfs/src/provider/local/local.provider.test.ts`
Expected: FAIL because mount objects and assumptions still include `syncMetadata`

**Step 3: Write minimal implementation**

Remove `syncMetadata` from mount construction and any logic that still references it. Keep syncer and node-event processor behavior intact except for type updates and dead-path cleanup.

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.integration.test.ts packages/vfs/src/provider/local/local.provider.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/vfs/src/vfs.syncer.ts packages/vfs/src/vfs.node-event-processor.ts packages/vfs/src/vfs.integration.test.ts packages/vfs/example/app.ts packages/vfs/src/provider/local/local.provider.test.ts
git commit -m "refactor(vfs): simplify mounts to syncContent only"
```

### Task 6: Run package-level verification

**Files:**
- Test: `packages/vfs/src/**/*.test.ts`

**Step 1: Run focused package tests**

Run: `bun test packages/vfs/src`
Expected: PASS

**Step 2: Run broader project verification for VFS consumers**

Run: `bun test src/bun`
Expected: PASS or only unrelated known failures

**Step 3: Review for dead code**

Run: `rg -n "syncMetadata|mode: \"remote\"|getPageCacheIfFresh|upsertPageCache|deletePageCacheByMountId" packages/vfs src`
Expected: no remaining references, or only intentional ones outside the new VFS model

**Step 4: Commit**

```bash
git add packages/vfs src
git commit -m "test: verify local-authority vfs refactor"
```
