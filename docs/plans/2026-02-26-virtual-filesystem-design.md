# Virtual File System Design (Mountable Multi-Provider + SQLite Metadata)

Date: 2026-02-26
Status: Approved
Scope: Design a provider-mountable virtual file system under `core`, with SQLite as metadata truth for hierarchical browsing and pagination.

## 1. Confirmed Decisions

- All entities are unified as abstract virtual files/folders (`VirtualFile` concept).
- Metadata is stored in SQLite and is the primary browsing truth.
- Mount supports multiple providers to paths, e.g.:
  - Google Drive -> `/abc/drive`
  - S3 -> `/abc/s3`
  - Local folder -> `/abc/local`
- Local mount uses existing strategy: watch + debounce + periodic reconcile (eventual consistency).
- Remote providers are split by capability:
  - watch-capable: watch + debounce + reconcile
  - reconcile-only: scheduled reconcile
- `walkChildren` is metadata-based when possible; supports cursor pagination.
- Provider can configure `syncMetadata`:
  - `true`: list from local metadata
  - `false`: list via provider remote pagination API, with page backfill into local metadata cache (TTL)
- VFS only owns metadata responsibilities (mount, node tree, pagination, reconcile trigger).
- Content extraction/rendering/chunking (e.g. markdown) is out of VFS scope.

## 2. Interface & Types (First-Class)

```ts
export type VfsNodeKind = "file" | "folder";

export interface VfsMountConfig {
  mountId: string;
  mountPath: string; // e.g. /abc/drive
  providerType: string; // google_drive | s3 | local | gmail ...
  providerExtra: Record<string, unknown>; // provider-specific metadata, e.g. token/tenant
  syncMetadata: boolean;
  metadataTtlSec: number;
  reconcileIntervalMs: number;
}

export interface VfsNode {
  nodeId: string;
  mountId: string;
  parentId: string | null;
  name: string;
  vpath: string; // globally unique virtual path
  kind: VfsNodeKind;
  title: string;
  size: number | null;
  mtimeMs: number | null;
  sourceRef: string; // provider native id
  providerVersion: string | null;
  deletedAtMs: number | null;
  updatedAtMs: number;
  createdAtMs: number;
}

export interface VfsCursor {
  mode: "local" | "remote";
  token: string; // base64/json encoded cursor
}

export interface WalkChildrenInput {
  path: string;
  limit: number;
  cursor?: VfsCursor;
}

export interface WalkChildrenOutput {
  items: VfsNode[];
  nextCursor?: VfsCursor;
  source: "local" | "remote";
}
```

### 2.1 Provider Adapter Types

Capabilities are not persisted in DB. They are declared in a provider registry keyed by `providerType`.

```ts
export interface ProviderCapabilities {
  watch: boolean;
}

export interface ProviderListChildrenResult {
  items: Array<{
    sourceRef: string;
    parentSourceRef: string | null;
    name: string;
    kind: "file" | "folder";
    title?: string;
    size?: number;
    mtimeMs?: number;
    providerVersion?: string;
  }>;
  nextCursor?: string;
}

export interface VfsProviderAdapter {
  readonly type: string;
  readonly capabilities: ProviderCapabilities;

  listChildren(input: {
    mount: VfsMountConfig;
    parentSourceRef: string | null;
    limit: number;
    cursor?: string;
  }): Promise<ProviderListChildrenResult>;

  watch?(input: {
    mount: VfsMountConfig;
    onEvent: (event: {
      type: "upsert" | "delete";
      sourceRef: string;
      parentSourceRef: string | null;
    }) => void;
  }): Promise<{ close: () => Promise<void> }>;
}
```

### 2.2 Core Service Types

```ts
export interface VfsService {
  mount(config: VfsMountConfig): Promise<void>;
  unmount(mountId: string): Promise<void>;

  walkChildren(input: WalkChildrenInput): Promise<WalkChildrenOutput>;

  triggerReconcile(mountId: string): Promise<void>;
}

export interface VfsSyncScheduler {
  enqueueMetadataUpsert(input: { mountId: string; sourceRef: string }): Promise<void>;
  enqueueMetadataDelete(input: { mountId: string; sourceRef: string }): Promise<void>;
}
```

## 3. SQLite Schema

### 3.1 `vfs_mounts`

- `mount_id TEXT PRIMARY KEY`
- `mount_path TEXT UNIQUE NOT NULL`
- `provider_type TEXT NOT NULL`
- `provider_extra TEXT NOT NULL` (JSON object serialized as string)
- `sync_metadata INTEGER NOT NULL`
- `metadata_ttl_sec INTEGER NOT NULL`
- `reconcile_interval_ms INTEGER NOT NULL`
- `last_reconcile_at_ms INTEGER`
- `created_at_ms INTEGER NOT NULL`
- `updated_at_ms INTEGER NOT NULL`

### 3.2 `vfs_nodes`

- `node_id TEXT PRIMARY KEY`
- `mount_id TEXT NOT NULL`
- `parent_id TEXT`
- `name TEXT NOT NULL`
- `vpath TEXT UNIQUE NOT NULL`
- `kind TEXT NOT NULL` (`file|folder`)
- `title TEXT NOT NULL`
- `size INTEGER`
- `mtime_ms INTEGER`
- `source_ref TEXT NOT NULL`
- `provider_version TEXT`
- `deleted_at_ms INTEGER`
- `created_at_ms INTEGER NOT NULL`
- `updated_at_ms INTEGER NOT NULL`
- unique: `(mount_id, source_ref)`
- index: `(mount_id, parent_id, name, node_id)`

### 3.3 `vfs_page_cache`

- `cache_key TEXT PRIMARY KEY` (`mount_id + parent_source_ref + cursor`)
- `items_json TEXT NOT NULL`
- `next_cursor TEXT`
- `expires_at_ms INTEGER NOT NULL`
- index: `(expires_at_ms)`

## 4. Pagination Design

- Local metadata mode (`syncMetadata=true`):
  - Sort by `(name ASC, node_id ASC)`.
  - Cursor token stores `{lastName,lastNodeId}`.
- Remote passthrough mode (`syncMetadata=false`):
  - Cursor token stores provider cursor.
  - Response pages are backfilled to `vfs_nodes` and `vfs_page_cache` with TTL.
- Unified API contract:
  - `walkChildren(path, cursor, limit) -> { items, nextCursor, source }`

## 5. Metadata Sync Flow

1. Mount startup:
- register mount config
- initialize provider adapter
- start watch if supported
- schedule reconcile job

2. watch-capable provider:
- consume provider events
- debounce per sourceRef
- enqueue metadata upsert/delete jobs
- periodic reconcile for repair

3. reconcile-only provider:
- no watch stream
- periodic list/diff
- enqueue repair jobs

4. local mount:
- reuse existing local watch + debounce + reconcile pipeline
- upsert into `vfs_nodes`

## 6. Error Handling

- classify errors: transient vs fatal
- retries with backoff: `1s/5s/20s`
- mount status tracks degraded state when retries exceeded
- file-level isolation: one node failure does not block other jobs

## 7. Testing Strategy

- Unit:
  - cursor pagination stability (local + remote)
  - metadata sync mode switch (`syncMetadata` true/false)
  - provider registry resolution
- Integration:
  - local filesystem metadata browsing behavior
  - mock watch-capable provider
  - mock reconcile-only provider
  - remote pagination backfill + TTL expiry

## 8. Non-Goals (Current Iteration)

- Content normalization/rendering/chunking pipeline in VFS.
- Cross-provider move/copy semantics.
- Global ACL/permission unification.
- Distributed workers.

## 9. Next Step

Content layer (markdown/parser/chunking) should be implemented separately and consume VFS node metadata as upstream inputs.
