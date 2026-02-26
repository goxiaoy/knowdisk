# Virtual File System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a mountable virtual file system in `core` with SQLite metadata truth, provider-backed pagination, and markdown-centric content caching/chunking.

**Architecture:** Add a new `src/core/vfs` module with clear boundaries: `types`, `provider adapters/registry`, `repository (SQLite)`, `sync scheduler`, and `service`. Keep metadata browsing and content caching separate: metadata in `vfs_nodes`, content in markdown cache + `vfs_chunks`.

**Tech Stack:** TypeScript, Bun runtime, `bun:sqlite`, existing parser/chunker utilities, Bun test.

---

### Task 1: Scaffold VFS Module and Core Types

**Skill refs:** @superpowers:test-driven-development

**Files:**
- Create: `src/core/vfs/vfs.types.ts`
- Create: `src/core/vfs/vfs.service.types.ts`
- Create: `src/core/vfs/vfs.provider.types.ts`
- Create: `src/core/vfs/vfs.types.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import type { VfsNode, VfsMountConfig, VfsCursor } from "./vfs.types";

describe("vfs types", () => {
  it("supports dual-version node model", () => {
    const node: VfsNode = {
      nodeId: "n1",
      mountId: "m1",
      parentId: null,
      name: "doc.md",
      vpath: "/abc/drive/doc.md",
      kind: "file",
      title: "doc",
      size: 10,
      mtimeMs: 1,
      sourceRef: "provider-id",
      providerVersion: "rev-1",
      contentHash: "sha256:xxx",
      contentState: "cached",
      deletedAtMs: null,
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    expect(node.providerVersion).toBe("rev-1");
    expect(node.contentHash).toContain("sha256");
  });

  it("supports cursor mode encoding boundary", () => {
    const cursor: VfsCursor = { mode: "local", token: "abc" };
    expect(cursor.mode).toBe("local");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/vfs/vfs.types.test.ts`
Expected: FAIL because files/types do not exist.

**Step 3: Write minimal implementation**

Add complete interfaces/types for:
- node, mount config, chunk, markdown cache
- cursor, walk input/output
- provider capabilities and adapter contract
- service contract

**Step 4: Run test to verify it passes**

Run: `bun test src/core/vfs/vfs.types.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/vfs/vfs.types.ts src/core/vfs/vfs.service.types.ts src/core/vfs/vfs.provider.types.ts src/core/vfs/vfs.types.test.ts
git commit -m "feat(vfs): add core interfaces and type contracts"
```

### Task 2: Add SQLite Repository Schema and CRUD

**Skill refs:** @superpowers:test-driven-development

**Files:**
- Create: `src/core/vfs/vfs.repository.types.ts`
- Create: `src/core/vfs/vfs.repository.ts`
- Create: `src/core/vfs/vfs.repository.test.ts`

**Step 1: Write the failing tests**

Cover these behaviors:
- creates/migrates tables: `vfs_mounts`, `vfs_nodes`, `vfs_chunks`, `vfs_markdown_cache`, `vfs_page_cache`
- upsert/get mount
- upsert/get/list node children with stable ordering `(name,node_id)`
- upsert/list chunks by `node_id,seq`
- save/get markdown cache
- save/get page cache with ttl checks

**Step 2: Run tests to verify failure**

Run: `bun test src/core/vfs/vfs.repository.test.ts`
Expected: FAIL (repository absent).

**Step 3: Write minimal implementation**

Implement `createVfsRepository({ dbPath })` with:
- `migrate(db)`
- `upsertMount`, `getMountById`
- `upsertNodes`, `listChildrenPageLocal`
- `upsertChunks`, `listChunksByNodeId`
- `upsertMarkdownCache`, `getMarkdownCache`
- `upsertPageCache`, `getPageCacheIfFresh`

Follow existing style from `src/core/indexing/metadata/index-metadata.repository.ts`.

**Step 4: Run tests to verify pass**

Run: `bun test src/core/vfs/vfs.repository.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/vfs/vfs.repository.types.ts src/core/vfs/vfs.repository.ts src/core/vfs/vfs.repository.test.ts
git commit -m "feat(vfs): add sqlite repository and schema"
```

### Task 3: Provider Registry and Capabilities Resolution

**Skill refs:** @superpowers:test-driven-development

**Files:**
- Create: `src/core/vfs/vfs.provider.registry.ts`
- Create: `src/core/vfs/vfs.provider.registry.test.ts`

**Step 1: Write failing tests**

Test cases:
- register/get adapter by `providerType`
- expose capability flags from code registry (not DB)
- throw clear error for unknown provider

**Step 2: Run tests to verify failure**

Run: `bun test src/core/vfs/vfs.provider.registry.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Create a registry object:
- `register(adapter)`
- `get(providerType)`
- `listTypes()`

Use in-memory map keyed by `adapter.type`.

**Step 4: Run tests to verify pass**

Run: `bun test src/core/vfs/vfs.provider.registry.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/vfs/vfs.provider.registry.ts src/core/vfs/vfs.provider.registry.test.ts
git commit -m "feat(vfs): add provider registry with capability resolution"
```

### Task 4: Cursor Codec for Local and Remote Pagination

**Skill refs:** @superpowers:test-driven-development

**Files:**
- Create: `src/core/vfs/vfs.cursor.ts`
- Create: `src/core/vfs/vfs.cursor.test.ts`

**Step 1: Write failing tests**

Test cases:
- encode/decode local cursor `{lastName,lastNodeId}`
- encode/decode remote cursor `{providerCursor}`
- rejects malformed token

**Step 2: Run tests to verify failure**

Run: `bun test src/core/vfs/vfs.cursor.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement base64 JSON codec with runtime validation.

**Step 4: Run tests to verify pass**

Run: `bun test src/core/vfs/vfs.cursor.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/vfs/vfs.cursor.ts src/core/vfs/vfs.cursor.test.ts
git commit -m "feat(vfs): add safe cursor codec for local and remote paging"
```

### Task 5: Metadata Walk Service (`walkChildren`)

**Skill refs:** @superpowers:test-driven-development

**Files:**
- Create: `src/core/vfs/vfs.service.ts`
- Create: `src/core/vfs/vfs.service.walk.test.ts`
- Modify: `src/bun/app.container.ts`

**Step 1: Write failing tests**

Scenarios:
- `syncMetadata=true`: resolve path in local nodes and return local page with local cursor
- `syncMetadata=false`: call provider `listChildren`, backfill nodes/page cache, return remote cursor
- `syncMetadata=false` with fresh cached page and same cursor: return cache hit

**Step 2: Run tests to verify failure**

Run: `bun test src/core/vfs/vfs.service.walk.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement `walkChildren` only:
- mount resolution by path prefix
- local path: `listChildrenPageLocal`
- remote path: provider list + cache backfill
- return `{items,nextCursor,source}`

Wire service construction in `app.container.ts`.

**Step 4: Run tests to verify pass**

Run: `bun test src/core/vfs/vfs.service.walk.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/vfs/vfs.service.ts src/core/vfs/vfs.service.walk.test.ts src/bun/app.container.ts
git commit -m "feat(vfs): implement walkChildren with local/remote cursor paging"
```

### Task 6: Markdown Refresh Pipeline (`readMarkdown`)

**Skill refs:** @superpowers:test-driven-development

**Files:**
- Create: `src/core/vfs/vfs.service.read.test.ts`
- Modify: `src/core/vfs/vfs.service.ts`
- Modify: `src/core/parser/parser.registry.ts` (only if adapter path needs parser entrypoint exposure)

**Step 1: Write failing tests**

Scenarios:
- cache hit returns markdown immediately
- stale by provider version triggers refresh
- refresh path chooses `exportMarkdown` when supported
- fallback path uses `downloadRaw` + parser -> markdown
- after refresh, writes markdown cache + chunks + content hash

**Step 2: Run tests to verify failure**

Run: `bun test src/core/vfs/vfs.service.read.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement `readMarkdown(path)` and private `refreshMarkdown(node)`.
Chunk markdown into `vfs_chunks` with stable `seq`.

**Step 4: Run tests to verify pass**

Run: `bun test src/core/vfs/vfs.service.read.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/vfs/vfs.service.ts src/core/vfs/vfs.service.read.test.ts src/core/parser/parser.registry.ts
git commit -m "feat(vfs): add markdown cache refresh and chunk pipeline"
```

### Task 7: Sync Scheduler for Watch/Reconcile Modes

**Skill refs:** @superpowers:test-driven-development

**Files:**
- Create: `src/core/vfs/vfs.sync.scheduler.ts`
- Create: `src/core/vfs/vfs.sync.scheduler.test.ts`
- Modify: `src/core/config/config.types.ts`
- Modify: `src/core/config/default-config.ts`

**Step 1: Write failing tests**

Scenarios:
- watch events are debounced per sourceRef
- reconcile job runs for reconcile-only providers
- retries apply backoff (1s/5s/20s)
- failed nodes do not block queue

**Step 2: Run tests to verify failure**

Run: `bun test src/core/vfs/vfs.sync.scheduler.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Add queue/scheduler with:
- event coalescing
- periodic reconcile timer per mount
- retry policy with capped attempts

Add config section for VFS sync intervals/backoff.

**Step 4: Run tests to verify pass**

Run: `bun test src/core/vfs/vfs.sync.scheduler.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/vfs/vfs.sync.scheduler.ts src/core/vfs/vfs.sync.scheduler.test.ts src/core/config/config.types.ts src/core/config/default-config.ts
git commit -m "feat(vfs): add sync scheduler for watch and reconcile providers"
```

### Task 8: Integration Wiring and RPC Surface

**Skill refs:** @superpowers:test-driven-development

**Files:**
- Modify: `src/bun/index.ts`
- Modify: `src/mainview/services/bun.rpc.ts`
- Create: `src/core/vfs/vfs.integration.test.ts`

**Step 1: Write failing integration tests**

Scenarios:
- mount local folder and page children from metadata
- mount remote mock provider and page children via remote cursor
- read markdown from lazy remote node and verify cache reuse

**Step 2: Run tests to verify failure**

Run: `bun test src/core/vfs/vfs.integration.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Expose core RPCs:
- `vfs.mount`
- `vfs.walkChildren`
- `vfs.readMarkdown`
- `vfs.triggerReconcile`

Wire through app container and Bun RPC bridge.

**Step 4: Run tests to verify pass**

Run: `bun test src/core/vfs/vfs.integration.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/bun/index.ts src/mainview/services/bun.rpc.ts src/core/vfs/vfs.integration.test.ts
git commit -m "feat(vfs): expose vfs rpc and verify end-to-end integration"
```

### Task 9: Full Verification and Docs Sync

**Skill refs:** @superpowers:verification-before-completion @superpowers:requesting-code-review

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/plans/2026-02-26-virtual-filesystem-design.md` (if implementation deviations exist)

**Step 1: Run targeted tests**

Run:
- `bun test src/core/vfs`
- `bun test src/core/indexing`

Expected: PASS.

**Step 2: Run full tests**

Run: `bun test`
Expected: PASS, no regressions.

**Step 3: Update docs**

Document:
- VFS concepts
- mount config flags (`syncMetadata`, `syncContent`)
- cursor semantics

**Step 4: Commit**

```bash
git add README.md README.zh-CN.md docs/plans/2026-02-26-virtual-filesystem-design.md
git commit -m "docs(vfs): document mount sync modes and paging behavior"
```

