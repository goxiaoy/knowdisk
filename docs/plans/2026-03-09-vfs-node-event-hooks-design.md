# VFS Node Event Hooks Design

**Goal:** Add a service-level blocking hook pipeline around VFS node event consumption so callers can run custom logic before and after `add`, `update_metadata`, `update_content`, `delete`, and content sync.

**Status:** Approved for implementation.

---

## Problem

The current VFS pipeline exposes two observable points:

- queued node events in `vfs_node_events`
- persisted node changes after `repository.upsertNodes(...)`

That is not enough for workflows that need lifecycle control around syncer execution itself. The missing capability is a blocking hook layer around event application, for example:

- `before_add`: the syncer discovered or queued an add event, but `applyNodeEvent(...)` has not run yet
- `after_add`: the add event has been applied successfully
- `before_update_metadata`
- `after_update_metadata`
- `before_update_content`
- `after_update_content`
- `before_delete`
- `after_delete`
- `before_sync_content`
- `after_sync_content`

The hooks must be part of the main control flow, not passive notifications.

---

## Requirements

### Functional requirements

- Expose the capability from `VfsService`, not directly from `VfsSyncer`.
- Allow multiple hook registrations.
- Execute handlers serially in registration order.
- Support the following hook names:
  - `before_add`
  - `after_add`
  - `before_update_metadata`
  - `after_update_metadata`
  - `before_update_content`
  - `after_update_content`
  - `before_delete`
  - `after_delete`
  - `before_sync_content`
  - `after_sync_content`
- Apply the same hook behavior to both `fullSync()` and watch-driven event processing.
- Trigger hooks during event consumption, not during event production.

### Failure semantics

- `before_*` hook failure blocks the main flow for that event.
- If a `before_*` hook throws, the event must remain queued for retry.
- `after_*` hook failure does not block queue deletion.
- If an `after_*` hook throws, log it and continue deleting the event.
- `before_sync_content` failure blocks content sync and keeps the event queued.
- `after_sync_content` failure logs only; it does not roll back downloaded files and does not keep the event queued.

### Delivery semantics

- Hook execution is `at-least-once`, not exactly-once.
- Hook implementations must tolerate retries and repeated observation.

---

## Architecture

### Public API

Add a registration method on `VfsService`:

```ts
export type VfsNodeEventHookContext = {
  mount: VfsMount;
  event: VfsNodeEventRow;
  prevNode: VfsNode | null;
  nextNode: VfsNode | null;
};

export type VfsSyncContentHookContext = {
  mount: VfsMount;
  event: VfsNodeEventRow;
  node: VfsNode;
  finalPath: string;
  partPath: string;
  startOffset: number;
};

export type VfsNodeEventHooks = {
  before_add?: (ctx: VfsNodeEventHookContext) => Promise<void> | void;
  after_add?: (ctx: VfsNodeEventHookContext) => Promise<void> | void;
  before_update_metadata?: (ctx: VfsNodeEventHookContext) => Promise<void> | void;
  after_update_metadata?: (ctx: VfsNodeEventHookContext) => Promise<void> | void;
  before_update_content?: (ctx: VfsNodeEventHookContext) => Promise<void> | void;
  after_update_content?: (ctx: VfsNodeEventHookContext) => Promise<void> | void;
  before_delete?: (ctx: VfsNodeEventHookContext) => Promise<void> | void;
  after_delete?: (ctx: VfsNodeEventHookContext) => Promise<void> | void;
  before_sync_content?: (ctx: VfsSyncContentHookContext) => Promise<void> | void;
  after_sync_content?: (ctx: VfsSyncContentHookContext) => Promise<void> | void;
};

registerNodeEventHooks(hooks: VfsNodeEventHooks): () => void;
```

The returned function unsubscribes the registration.

### Ownership model

- `VfsService` owns the hook registry.
- `VfsSyncer` receives a narrow `hookRunner` dependency from the service.
- `VfsRepository` remains unaware of hook execution.

This keeps hook orchestration at the service boundary and avoids pushing policy into storage.

---

## Execution Flow

### Event production

`fullSync()` and watch handling continue to produce `VfsNodeEventRow` values exactly as they do today.

No hooks run during event production.

Reason:
- the desired semantics are tied to `applyNodeEvent(...)`
- producer-side hooks would split behavior between `fullSync()` and watch generation paths
- the current architecture already unifies both paths at queue consumption time

### Event consumption

For each queued event in `runNodeEventsHandler(...)`:

1. Fetch `prevNode` from the repository by `(mountId, sourceRef)`.
2. Build `VfsNodeEventHookContext` with:
   - `mount`
   - `event`
   - `prevNode`
   - `nextNode = null`
3. Run `before_${event.type}` across all registrations in order.
4. If all succeed, run `applyNodeEvent(...)`.
5. Read `nextNode` from the repository after apply.
6. Run `after_${event.type}` across all registrations in order.
7. Delete the event from the queue unless a blocking failure occurred before apply or during content-sync blocking stages.

### Content sync

For each file processed in `syncContent(...)`:

1. Build `VfsSyncContentHookContext`.
2. Run `before_sync_content` across registrations.
3. If all succeed, download and finalize the file.
4. Run `after_sync_content` across registrations.

The `syncContent(...)` hooks are scoped to actual file transfer, not to metadata-only event application.

---

## Hook Semantics by Event Type

### `add`

Current behavior already expands an add diff into:

- `add`
- `update_metadata`
- `update_content`

That remains unchanged.

Therefore the hook sequence for a newly added file can be:

1. `before_add`
2. `after_add`
3. `before_update_metadata`
4. `after_update_metadata`
5. `before_update_content`
6. `before_sync_content` if file content must be downloaded
7. `after_sync_content` if download succeeds
8. `after_update_content`

This is intentional. The hook model follows the existing event model rather than introducing a separate synthetic lifecycle.

### `update_metadata`

Runs around metadata-only application. It does not imply content sync.

### `update_content`

Runs around the content-update event application. If the event requires file download, `before_sync_content` / `after_sync_content` are nested inside this flow.

### `delete`

Runs around logical deletion in the repository. No content-sync hooks apply.

---

## Failure and Retry Behavior

### `before_*` failures

If any `before_*` hook throws:

- stop processing that event
- do not call `applyNodeEvent(...)`
- do not delete the event from `vfs_node_events`
- log the failure with hook metadata
- allow later retries to re-run the same `before_*` hooks

### `after_*` failures

If any `after_*` hook throws:

- log the failure
- do not roll back repository changes
- still delete the event from `vfs_node_events`

### `before_sync_content` failures

If any `before_sync_content` hook throws:

- stop the file download for that event
- treat the content phase as failed
- keep the event queued for retry

### `after_sync_content` failures

If any `after_sync_content` hook throws:

- log the failure
- keep the downloaded file in place
- do not mark the event as failed solely because the post-hook failed

This keeps file transfer success separate from post-processing failures.

---

## Logging

Add structured logs for hook failures with at least:

- `mountId`
- `sourceRef`
- `eventType`
- `hookName`
- `stage`
- `error`

Recommended log messages:

- `syncer before hook failed`
- `syncer after hook failed`
- `syncer syncContent before hook failed`
- `syncer syncContent after hook failed`

This is necessary for diagnosing stuck queued events caused by `before_*` failures.

---

## Testing Strategy

### Syncer tests

Add tests in `packages/vfs/src/vfs.syncer.test.ts` for:

- `before_add` throws -> event remains queued
- `after_add` throws -> event is deleted
- `before_update_metadata` throws -> repository unchanged for that event
- `before_sync_content` throws -> final file not written, event remains queued
- `after_sync_content` throws -> final file exists, event is deleted

### Service runtime tests

Add tests in `packages/vfs/src/vfs.service.runtime.test.ts` for:

- multiple `registerNodeEventHooks(...)` registrations run in order
- unsubscribe removes only its own registration
- syncers created after registration still use the service-level hooks

### Type/API tests

Add or update tests verifying:

- `VfsService` exports `registerNodeEventHooks`
- hook types are available from the package entrypoint

### Documentation coverage

Document explicitly that:

- hook execution is `at-least-once`
- `after_*` hooks are best-effort and non-transactional
- content-sync hooks are tied to actual file download, not metadata changes alone

---

## Non-Goals

- No repository-level hook execution.
- No producer-side hooks during diff generation.
- No rollback transaction model for `after_*` failures.
- No exactly-once delivery guarantee.
- No UI/example feature work beyond what is needed to keep typings and examples correct.

---

## Open Decisions Resolved

- Hooks are registered on `VfsService`.
- Hooks are blocking.
- `before_*` failure keeps the event queued.
- `after_*` failure logs only and still deletes the event.
- `before_sync_content` and `after_sync_content` are included.
- Multiple hook registrations are supported and run in registration order.
