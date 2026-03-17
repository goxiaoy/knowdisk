# VFS Node Events Processor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split node event consumption out of `VfsSyncer` into a dedicated processor so syncers only enqueue events and the service owns one unified consumer.

**Architecture:** Keep `vfs.syncer.ts` focused on remote reconciliation and watch ingestion. Move queue draining, hook execution, retry/block semantics, and mount snapshot handling into a dedicated `vfs.node-events-processor.ts` object created by `vfs.service.ts`. Preserve current reconcile semantics by explicitly draining metadata-only events after `fullSync`.

**Tech Stack:** TypeScript, Bun tests, repository-backed queue processing, pino logging

---

### Task 1: Lock the boundary with tests

**Files:**
- Modify: `packages/vfs/src/vfs.service.runtime.test.ts`
- Modify: `packages/vfs/src/vfs.syncer.test.ts`

**Step 1: Write the failing test**

Add/update tests to prove:
- unmount still drains queued delete events through the centralized processor
- syncer behavior no longer depends on an internal `manageNodeEvents` mode switch

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/vfs.service.runtime.test.ts packages/vfs/src/vfs.syncer.test.ts`
Expected: FAIL because the current implementation still mixes syncer and processor responsibilities.

**Step 3: Write minimal implementation**

Refactor only enough code to make the new processor boundary real while keeping existing behavior green.

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.service.runtime.test.ts packages/vfs/src/vfs.syncer.test.ts`
Expected: PASS

### Task 2: Extract the processor

**Files:**
- Create: `packages/vfs/src/vfs.node-events-processor.ts`
- Modify: `packages/vfs/src/vfs.service.ts`
- Modify: `packages/vfs/src/vfs.syncer.ts`
- Modify: `packages/vfs/src/vfs.repository.ts`
- Modify: `packages/vfs/src/vfs.repository.types.ts`

**Step 1: Write the failing test**

Use Task 1 coverage as the executable failing spec.

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/vfs.service.runtime.test.ts packages/vfs/src/vfs.syncer.test.ts`
Expected: FAIL before the extraction is complete.

**Step 3: Write minimal implementation**

- Introduce a dedicated processor API/class/factory for queue draining
- Remove `manageNodeEvents` and local queue-consumption scheduling from `vfs.syncer.ts`
- Let `vfs.service.ts` own one processor instance and mount snapshots
- Keep immediate metadata-event draining after reconcile to preserve current semantics

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.service.runtime.test.ts packages/vfs/src/vfs.syncer.test.ts`
Expected: PASS

### Task 3: Verify broader VFS behavior

**Files:**
- No code changes required unless regressions appear

**Step 1: Run focused verification**

Run: `bun test packages/vfs/src/vfs.repository.test.ts packages/vfs/src/vfs.integration.test.ts`
Expected: PASS

**Step 2: Run broader verification if practical**

Run: `bun test packages/vfs/src`
Expected: PASS, or note any long-running external integration suites if they are intentionally skipped/stopped.
