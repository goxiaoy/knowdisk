# VFS Local Metadata Authority Design

**Problem**

`packages/vfs` currently supports two browsing modes:

- `syncMetadata=true`: browse from the local VFS metadata store
- `syncMetadata=false`: browse by fetching pages from the provider and backfilling the local store

This makes metadata authority ambiguous. The service can return provider-backed remote pages during browse, while syncers and node-event processors separately maintain the local metadata database.

**Goal**

Make VFS the sole authority for provider metadata. Browsing should always read from the local VFS database. Providers should only be used to synchronize metadata into the database and, optionally, content into the local content store.

**User-Facing Semantics**

- `walkChildren` always reads from the local VFS database.
- If a mount or directory has not been synchronized yet, `walkChildren` may return an empty or partial result.
- `syncContent` remains the only metadata/content-related mount toggle.
- Old database compatibility is out of scope. Schema changes may be destructive.

**Current Architecture Summary**

- `VfsMountConfig` includes both `syncMetadata` and `syncContent`.
- `walkChildren` branches on `syncMetadata`.
  - local branch returns repository pages
  - remote branch calls provider `listChildren`, persists results into the repository, and maintains a remote page cache
- syncers already perform full metadata reconciliation and watch-driven incremental updates into the repository

This means the runtime has two distinct browse paths, but only one persistent metadata store.

**Target Architecture**

1. Remove `syncMetadata` from mount config, runtime objects, and persistence.
2. Make `walkChildren` always read local repository pages.
3. Remove remote page-cache and remote-cursor browsing behavior from the service layer.
4. Keep provider `listChildren`, `getMetadata`, and `getVersion` for sync and reconciliation only.
5. Keep provider watch events and node-event processing as the mechanism that updates local metadata after initial sync.

**Expected Code Changes**

- `packages/vfs/src/vfs.types.ts`
  - remove `syncMetadata`
  - simplify `WalkChildrenOutput.source` if remote is no longer observable
- `packages/vfs/src/vfs.repository.types.ts`
  - remove `syncMetadata` from mount ext row types
  - assess whether page cache types are still needed
- `packages/vfs/src/vfs.repository.ts`
  - remove `sync_metadata` column reads/writes
  - remove page-cache storage if fully unused after service changes
  - update schema creation
- `packages/vfs/src/vfs.service.ts`
  - remove remote browse branch from `walkChildren`
  - stop reconstructing `syncMetadata` from mount ext rows
- `packages/vfs/src/vfs.service.walk.test.ts`
  - replace remote browse assertions with local-authority assertions
- integration and example files
  - update mount creation to remove `syncMetadata`

**Trade-Offs**

**Pros**

- One clear metadata authority: the VFS database
- Simpler browse model
- Fewer service-layer branches and fewer mount configuration combinations
- Easier reasoning about stale vs. current state

**Cons**

- Initial browse can show empty results until sync completes
- Provider browse latency is no longer hidden by on-demand page fetches
- The system becomes more dependent on sync/reconcile correctness

**Rejected Alternative**

Keep `syncMetadata` but default it to local-authority behavior. This preserves compatibility but leaves the conceptual split in place. Since the goal is to remove ambiguity, this does not go far enough.

**Testing Strategy**

- Update unit tests to assert that `walkChildren` always returns local results
- Remove tests that expect remote page fetches, remote cursors, or page-cache hits
- Add tests proving that unsynced mounts return empty local results
- Add or update integration tests to verify that reconcile populates local browse results

**Open Constraint**

This design intentionally does not preserve older databases. The repository schema can be changed directly without a migration layer.
