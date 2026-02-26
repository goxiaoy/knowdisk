# Virtual File System Design (Mountable Multi-Provider + SQLite Metadata)

Date: 2026-02-26
Status: Approved
Scope: Design a provider-mountable virtual file system under `core`, with SQLite as metadata truth and markdown-centric content cache/chunks.

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
- Provider can configure `syncContent`:
  - `eager`: proactively sync content
  - `lazy`: fetch on first read
- Core content representation is markdown.
  - If provider can export markdown directly, cache markdown.
  - Otherwise download raw file and convert via parser to markdown, then cache.
- Version model stores both:
  - `provider_version`
  - `content_hash`

## 2. Interface & Types (First-Class)

```ts
export type VfsNodeKind = "file" | "folder";
export type SyncMode = "eager" | "lazy";
export type ContentState = "missing" | "cached" | "stale";

export interface VfsMountConfig {
  mountId: string;
  mountPath: string; // e.g. /abc/drive
  providerType: string; // google_drive | s3 | local | gmail ...
  syncMetadata: boolean;
  syncContent: SyncMode;
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
  contentHash: string | null;
  contentState: ContentState;
  deletedAtMs: number | null;
  updatedAtMs: number;
  createdAtMs: number;
}

export interface VfsChunk {
  chunkId: string;
  nodeId: string;
  seq: number; // stable ordering
  markdownChunk: string;
  tokenCount: number | null;
  chunkHash: string;
  updatedAtMs: number;
}

export interface VfsMarkdownCache {
  nodeId: string;
  markdownFull: string;
  markdownHash: string;
  generatedBy: "provider_export" | "parser";
  updatedAtMs: number;
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
  exportMarkdown: boolean;
  downloadRaw: boolean;
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

  exportMarkdown?(input: {
    mount: VfsMountConfig;
    sourceRef: string;
  }): Promise<{ markdown: string; providerVersion?: string }>;

  downloadRaw?(input: {
    mount: VfsMountConfig;
    sourceRef: string;
  }): Promise<{ localPath: string; providerVersion?: string }>;
}
```

### 2.2 Core Service Types

```ts
export interface VfsService {
  mount(config: VfsMountConfig): Promise<void>;
  unmount(mountId: string): Promise<void>;

  walkChildren(input: WalkChildrenInput): Promise<WalkChildrenOutput>;
  readMarkdown(path: string): Promise<{ node: VfsNode; markdown: string }>;

  triggerReconcile(mountId: string): Promise<void>;
}

export interface VfsSyncScheduler {
  enqueueMetadataUpsert(input: { mountId: string; sourceRef: string }): Promise<void>;
  enqueueMetadataDelete(input: { mountId: string; sourceRef: string }): Promise<void>;
  enqueueContentRefresh(input: { nodeId: string; reason: string }): Promise<void>;
}
```

## 3. SQLite Schema

### 3.1 `vfs_mounts`

- `mount_id TEXT PRIMARY KEY`
- `mount_path TEXT UNIQUE NOT NULL`
- `provider_type TEXT NOT NULL`
- `sync_metadata INTEGER NOT NULL`
- `sync_content TEXT NOT NULL` (`eager|lazy`)
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
- `content_hash TEXT`
- `content_state TEXT NOT NULL` (`missing|cached|stale`)
- `deleted_at_ms INTEGER`
- `created_at_ms INTEGER NOT NULL`
- `updated_at_ms INTEGER NOT NULL`
- unique: `(mount_id, source_ref)`
- index: `(mount_id, parent_id, name, node_id)`

### 3.3 `vfs_chunks`

- `chunk_id TEXT PRIMARY KEY`
- `node_id TEXT NOT NULL`
- `seq INTEGER NOT NULL`
- `markdown_chunk TEXT NOT NULL`
- `token_count INTEGER`
- `chunk_hash TEXT NOT NULL`
- `updated_at_ms INTEGER NOT NULL`
- unique: `(node_id, seq)`
- index: `(node_id, seq)`

### 3.4 `vfs_markdown_cache`

- `node_id TEXT PRIMARY KEY`
- `markdown_full TEXT NOT NULL`
- `markdown_hash TEXT NOT NULL`
- `generated_by TEXT NOT NULL` (`provider_export|parser`)
- `updated_at_ms INTEGER NOT NULL`

### 3.5 `vfs_page_cache`

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

## 6. Markdown Content Flow

1. Trigger conditions:
- `syncContent=eager` on metadata upsert
- `syncContent=lazy` on first `readMarkdown`
- provider version mismatch

2. Refresh pipeline:
- if provider supports export markdown: `exportMarkdown`
- else: `downloadRaw` + parser to markdown
- write `vfs_markdown_cache`
- re-chunk markdown to `vfs_chunks`
- compute/update `content_hash`
- set `content_state=cached`

3. Staleness:
- if `provider_version` changed -> mark `stale`
- read path will refresh stale content before return

## 7. Error Handling

- classify errors: transient vs fatal
- retries with backoff: `1s/5s/20s`
- mount status tracks degraded state when retries exceeded
- file-level isolation: one node failure does not block other jobs

## 8. Testing Strategy

- Unit:
  - cursor pagination stability (local + remote)
  - metadata sync mode switch (`syncMetadata` true/false)
  - content sync mode switch (`syncContent` eager/lazy)
  - stale detection from `provider_version`
- Integration:
  - local filesystem realtime sync behavior
  - mock watch-capable provider
  - mock reconcile-only provider
  - remote pagination backfill + TTL expiry

## 9. Non-Goals (Current Iteration)

- Cross-provider move/copy semantics.
- Global ACL/permission unification.
- Distributed workers.

## 10. Next Step

Use `writing-plans` to produce a concrete implementation plan (phases, migration steps, test gates), with interface-first sequencing.
