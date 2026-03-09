# VFS Node Event Hooks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add service-level blocking hooks around VFS node event consumption and content sync, with retry semantics for `before_*` failures and best-effort semantics for `after_*` failures.

**Architecture:** `VfsService` owns a hook registry and exposes `registerNodeEventHooks(...)`. Each syncer receives a narrow hook-runner dependency so full sync and watch processing share the same lifecycle behavior at queue-consumption time. `VfsRepository` remains unaware of hooks.

**Tech Stack:** TypeScript, Bun, existing VFS service/syncer/repository layers, Bun test.

---

### Task 1: Add hook types to the public service API

**Files:**
- Modify: `packages/vfs/src/vfs.service.types.ts`
- Modify: `packages/vfs/src/index.ts`
- Test: `packages/vfs/src/vfs.service.runtime.test.ts`

**Step 1: Write the failing test**

Add a runtime/API test that expects `registerNodeEventHooks` to exist on the created service and to return an unsubscribe function.

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/vfs.service.runtime.test.ts`
Expected: FAIL because `registerNodeEventHooks` does not exist yet.

**Step 3: Write minimal implementation**

- Add `VfsNodeEventHookContext`
- Add `VfsSyncContentHookContext`
- Add `VfsNodeEventHooks`
- Add `registerNodeEventHooks(...)` to `VfsService`

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.service.runtime.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/vfs/src/vfs.service.types.ts packages/vfs/src/index.ts packages/vfs/src/vfs.service.runtime.test.ts
git commit -m "feat: add vfs node event hook api"
```

### Task 2: Add a service-level hook registry

**Files:**
- Modify: `packages/vfs/src/vfs.service.ts`
- Test: `packages/vfs/src/vfs.service.runtime.test.ts`

**Step 1: Write the failing test**

Add tests for:
- multiple registrations execute in order
- unsubscribe removes a registration

Use a lightweight service setup and capture call order in an array.

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/vfs.service.runtime.test.ts`
Expected: FAIL because ordering/unsubscribe behavior is not implemented.

**Step 3: Write minimal implementation**

- Store registrations in insertion order
- `registerNodeEventHooks(...)` returns an unsubscribe that removes only that registration
- Prepare a narrow internal runner object to pass into new syncers

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.service.runtime.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/vfs/src/vfs.service.ts packages/vfs/src/vfs.service.runtime.test.ts
git commit -m "feat: add vfs hook registry"
```

### Task 3: Thread hook runner into syncer construction

**Files:**
- Modify: `packages/vfs/src/vfs.syncer.ts`
- Modify: `packages/vfs/src/vfs.service.ts`
- Test: `packages/vfs/src/vfs.service.runtime.test.ts`

**Step 1: Write the failing test**

Add a test proving that a syncer created after hook registration still uses the registered hooks.

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/vfs.service.runtime.test.ts`
Expected: FAIL because new syncers do not receive the hook runner yet.

**Step 3: Write minimal implementation**

- Extend syncer factory input with an internal hook-runner dependency
- Update `createVfsService(...)` to pass the runner when creating syncers

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.service.runtime.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/vfs/src/vfs.syncer.ts packages/vfs/src/vfs.service.ts packages/vfs/src/vfs.service.runtime.test.ts
git commit -m "feat: inject hook runner into vfs syncer"
```

### Task 4: Add blocking `before_*` and best-effort `after_*` around event application

**Files:**
- Modify: `packages/vfs/src/vfs.syncer.ts`
- Test: `packages/vfs/src/vfs.syncer.test.ts`

**Step 1: Write the failing tests**

Add tests for:
- `before_add` throws -> queued event remains
- `after_add` throws -> queued event is deleted
- `before_update_metadata` throws -> node is not updated

**Step 2: Run test to verify they fail**

Run: `bun test packages/vfs/src/vfs.syncer.test.ts`
Expected: FAIL because hooks are not executed yet.

**Step 3: Write minimal implementation**

In `runNodeEventsHandler(...)`:
- load `prevNode`
- run `before_${event.type}` hooks before `applyNodeEvent(...)`
- re-read `nextNode` after apply
- run `after_${event.type}` hooks
- preserve existing delete semantics, but change queue deletion so `before_*` failures keep the event queued while `after_*` failures do not

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.syncer.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/vfs/src/vfs.syncer.ts packages/vfs/src/vfs.syncer.test.ts
git commit -m "feat: add syncer event lifecycle hooks"
```

### Task 5: Add `before_sync_content` and `after_sync_content`

**Files:**
- Modify: `packages/vfs/src/vfs.syncer.ts`
- Test: `packages/vfs/src/vfs.syncer.test.ts`

**Step 1: Write the failing tests**

Add tests for:
- `before_sync_content` throws -> final file is not written and event remains queued
- `after_sync_content` throws -> final file exists and event is still deleted

**Step 2: Run test to verify they fail**

Run: `bun test packages/vfs/src/vfs.syncer.test.ts`
Expected: FAIL because content-sync hooks are not present.

**Step 3: Write minimal implementation**

In `syncContent(...)`:
- build `VfsSyncContentHookContext`
- run `before_sync_content` before download starts
- run `after_sync_content` after finalize rename succeeds
- apply failure policy exactly as designed

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.syncer.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/vfs/src/vfs.syncer.ts packages/vfs/src/vfs.syncer.test.ts
git commit -m "feat: add vfs sync content hooks"
```

### Task 6: Add structured logging for hook failures

**Files:**
- Modify: `packages/vfs/src/vfs.syncer.ts`
- Test: `packages/vfs/src/vfs.syncer.test.ts` or existing logger-focused tests if available

**Step 1: Write the failing test**

Add a test that uses a mock logger and asserts the expected hook failure log shape.

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/vfs.syncer.test.ts`
Expected: FAIL because hook failure logs do not exist or do not include the required fields.

**Step 3: Write minimal implementation**

Log at least:
- `mountId`
- `sourceRef`
- `eventType`
- `hookName`
- `stage`
- `error`

Use separate messages for node-event hooks vs content-sync hooks.

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.syncer.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/vfs/src/vfs.syncer.ts packages/vfs/src/vfs.syncer.test.ts
git commit -m "chore: log vfs hook failures"
```

### Task 7: Verify package exports and examples still type-check cleanly

**Files:**
- Modify: `packages/vfs/example/app.ts` only if typings require it
- Test: `packages/vfs/example/app.test.ts`
- Test: `packages/vfs/src/vfs.service.runtime.test.ts`

**Step 1: Write the failing test if needed**

Only add a test if the exported API surface or example integration requires one.

**Step 2: Run targeted verification**

Run:
- `bun test packages/vfs/example/app.test.ts`
- `bun x eslint packages/vfs --max-warnings=0`

Expected: identify any type/API fallout.

**Step 3: Write minimal implementation**

Adjust example or exported types only if required by the new hook API.

**Step 4: Run test to verify it passes**

Run:
- `bun test packages/vfs/example/app.test.ts`
- `bun x eslint packages/vfs --max-warnings=0`

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/vfs/example/app.ts packages/vfs/example/app.test.ts packages/vfs/src
 git commit -m "chore: align vfs example with hook api"
```

### Task 8: Run full VFS verification

**Files:**
- No code changes expected

**Step 1: Run full verification**

Run:

```bash
bun x eslint packages/vfs --max-warnings=0
bun test packages/vfs/src packages/vfs/example
```

Expected:
- ESLint exits 0
- Bun test reports 0 failures

**Step 2: If verification fails**

Fix one issue at a time using TDD. Re-run the same commands after each fix.

**Step 3: Commit final verification state**

```bash
git add packages/vfs
git commit -m "feat: add vfs node event hooks"
```
