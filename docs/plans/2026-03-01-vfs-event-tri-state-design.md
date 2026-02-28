# VFS Event Tri-State + Dual Queue Design

## Summary
This design introduces:
- `getVersion` in `VfsOperationCore`.
- Tri-state change flags for `VfsChangeEvent` (`boolean | null`).
- Local-provider-specific update semantics (`metadataChanged=true`, `contentUpdated=false`).
- Event compaction with precedence `true > null > false`.
- Two consumer queues in `VfsService`: fast metadata queue and debounced content queue.

## Goals
- Keep event compaction centralized in DB (`vfs_node_events`).
- Separate low-latency UI metadata refresh from heavier content-related work.
- Preserve uncertain state with `null` while still allowing deterministic merges.
- Avoid recomputing content hash in `VfsService` read paths.

## Non-Goals
- Reworking provider watch protocol for all providers.
- Introducing new external event transport protocols.
- Backward compatibility with previously published API contracts (project not yet released).

## API Design

### 1) `VfsOperationCore.getVersion`
Add:
- `getVersion?: (input: { id: string }) => Promise<string | null>`

Behavior:
- Local provider: resolve file path and compute BLAKE3 via `computeBlake3File`.
- `VfsService` implementation: return `providerVersion` from DB metadata (`vfs_nodes.provider_version`) for the given node id.

Rationale:
- Providers can expose source-of-truth version derivation.
- Service stays read-fast and deterministic by using persisted metadata.

### 2) `VfsChangeEvent` tri-state flags
Change:
- `contentUpdated: boolean | null`
- `metadataChanged: boolean | null`

Event type remains:
- `type: "upsert" | "delete"`

Semantics:
- `upsert(add)` => `metadataChanged=true`, `contentUpdated=true`
- Local provider regular update => `metadataChanged=true`, `contentUpdated=false`
- Unknown/indeterminate signal => `null`

## Event Compaction

Compaction still keyed by `node_id` in `vfs_node_events`.

### Merge rule
For each flag (`metadata_changed`, `content_updated`) when merging multiple `upsert` events:
- If any event has `true` => `true`
- Else if any event has `null` => `null`
- Else => `false`

Equivalent precedence:
- `true > null > false`

### Delete rule
- Incoming `delete` for a node removes/overrides prior queued event state for that node.
- Final compacted row becomes `type="delete"` with flag values persisted as merged/defined by policy (defaulting to `false` unless business requires otherwise).

## VfsService Dual Queue Consumption

Consume compacted DB events with two dispatch loops:

1. Metadata queue (fast path)
- Trigger: events with `metadataChanged !== false` or `type="delete"`.
- Flush policy: immediate tick (or tiny delay like 0-10ms).
- Consumer intent: refresh node metadata/list placement quickly.

2. Content queue (debounced path)
- Trigger: events with `contentUpdated !== false` or `type="delete"`.
- Flush policy: debounce window (e.g. 80-200ms, configurable constant).
- Consumer intent: content preview/index/cache updates with batching.

Notes:
- A single compacted event can be routed to both queues.
- Dedupe by `(nodeId, updatedAtMs)` or internal sequence id to avoid duplicate downstream work.

## Data Model Changes

`vfs_node_events` columns update:
- `metadata_changed` nullable integer
- `content_updated` nullable integer

Encoding:
- `1` => `true`
- `0` => `false`
- `NULL` => `null`

Migration:
- Add nullable handling in repository row mapping.
- Keep existing table and alter column behavior if needed.

## Error Handling
- `getVersion` local provider:
  - Missing file -> return `null` or throw provider error (match current provider conventions).
- Queue flush failures:
  - Do not drop unprocessed rows silently.
  - Log and retry on next tick.
- Listener exceptions:
  - Isolate per listener so one failure does not block others.

## Testing Strategy

1. Type/API tests
- `VfsOperationCore` exposes `getVersion`.
- `VfsChangeEvent` accepts nullable flags.

2. Repository compaction tests
- Merge combinations across true/null/false and verify precedence.
- Verify delete overrides prior upsert history.

3. Service queue tests
- Metadata-only event reaches fast queue quickly.
- Content-only/unknown event reaches debounced queue.
- Event with both signals routes to both queues.
- Delete routes to both queues.

4. Provider tests
- Local `getVersion` computes BLAKE3 for file.
- Service `getVersion` reads DB `providerVersion`.

## Alternatives Considered

1. Single queue only
- Simpler but cannot balance metadata responsiveness and content batching.

2. Two DB tables (`metadata_events`, `content_events`)
- Clear separation but higher write/merge complexity.

3. In-memory compaction before DB
- Lower latency, but less crash-safe and harder to reason about across restarts.

Chosen design keeps DB-centric compaction and adds queue separation at service dispatch.

## Rollout Plan
1. Types + repository tri-state support.
2. `getVersion` API + local provider implementation.
3. Service dual-queue dispatcher.
4. UI/client adaptation for nullable flags.
5. End-to-end verification and event storm tests.
