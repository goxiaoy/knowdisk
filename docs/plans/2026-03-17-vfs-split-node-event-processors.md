# Split VFS Node Event Processors Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split VFS node event handling into separate metadata and content processors, and add event-type filtering to repository queue reads.

**Architecture:** The repository will expose `listNodeEvents` with optional type filters so background workers can read disjoint slices of the queue. The runtime will own two independent processors: one for `add`/`update_metadata`/`delete`, and one for `update_content`, both running asynchronously without explicit drain calls from service methods.

**Tech Stack:** TypeScript, Bun, sqlite repository, VFS runtime tests

---

### Task 1: Add failing repository filter test

**Files:**
- Modify: `packages/vfs/src/vfs.repository.test.ts`
- Test: `packages/vfs/src/vfs.repository.test.ts`

**Step 1: Write the failing test**

Add a test that inserts mixed node event types and asserts `listNodeEvents({ types: ["update_content"] })` only returns content events.

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/vfs.repository.test.ts -t "listNodeEvents filters by type"`
Expected: FAIL because `listNodeEvents` does not accept filter options yet.

**Step 3: Write minimal implementation**

Update repository types/sql to support optional type filtering.

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.repository.test.ts -t "listNodeEvents filters by type"`
Expected: PASS

### Task 2: Add failing async processor split test

**Files:**
- Modify: `packages/vfs/src/vfs.service.runtime.test.ts`
- Modify: `packages/vfs/src/vfs.syncer.test.ts`
- Test: `packages/vfs/src/vfs.service.runtime.test.ts`

**Step 1: Write the failing test**

Add a runtime test that enqueues metadata and content work, asserts `triggerReconcile()` resolves before queue drain, and eventually both processor classes clear their own event types.

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/vfs.service.runtime.test.ts -t "triggerReconcile enqueues work and processors drain asynchronously"`
Expected: FAIL because service still uses synchronous drain and only one processor exists.

**Step 3: Write minimal implementation**

Split node event processors into metadata/content variants and remove explicit drain calls from service.

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.service.runtime.test.ts -t "triggerReconcile enqueues work and processors drain asynchronously"`
Expected: PASS

### Task 3: Refactor shared processor core

**Files:**
- Modify: `packages/vfs/src/vfs.node-event-processor.ts`
- Modify: `packages/vfs/src/index.ts`
- Test: `packages/vfs/src/vfs.syncer.test.ts`
- Test: `packages/vfs/src/vfs.syncer.integration.test.ts`

**Step 1: Write the failing test**

Adjust syncer tests to construct metadata/content processors explicitly so old single-processor assumptions fail.

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/vfs.syncer.test.ts packages/vfs/src/vfs.syncer.integration.test.ts -t "node events processor"`
Expected: FAIL because exports/API no longer match.

**Step 3: Write minimal implementation**

Extract a filtered processor factory plus public metadata/content processor creators.

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.syncer.test.ts packages/vfs/src/vfs.syncer.integration.test.ts`
Expected: PASS

### Task 4: Verify the full affected suite

**Files:**
- Test: `packages/vfs/src/vfs.repository.test.ts`
- Test: `packages/vfs/src/vfs.service.runtime.test.ts`
- Test: `packages/vfs/src/vfs.syncer.test.ts`
- Test: `packages/vfs/src/vfs.syncer.integration.test.ts`
- Test: `packages/vfs/src/vfs.integration.test.ts`

**Step 1: Run full verification**

Run: `bun test packages/vfs/src/vfs.repository.test.ts packages/vfs/src/vfs.service.runtime.test.ts packages/vfs/src/vfs.syncer.test.ts packages/vfs/src/vfs.integration.test.ts`

Run: `bun test packages/vfs/src/vfs.syncer.integration.test.ts -t "local provider fullSync and watch stay aligned with filesystem changes"`

**Step 2: Confirm output**

Expected: 0 failures.
