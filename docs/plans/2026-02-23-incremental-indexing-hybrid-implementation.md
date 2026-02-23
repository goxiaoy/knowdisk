# Incremental Indexing + Hybrid Retrieval Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build robust incremental indexing with SQLite metadata (`bun:sqlite`), watcher + reconcile repair loop, and hybrid retrieval (vector + FTS) merged before reranking.

**Architecture:** Add a SQLite metadata repository as the indexing state machine, route file events to deduped jobs, process jobs with bounded worker concurrency, and keep vector/FTS metadata synchronized. Retrieval performs parallel vector and FTS recall, merges by `chunk_id`, then reranks once.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, chokidar, zvec, pino, Bun test.

---

### Task 1: Add Config Surface for Incremental Indexing + Hybrid Retrieval

**Files:**
- Modify: `src/core/config/config.types.ts`
- Modify: `src/core/config/config.service.ts`
- Modify: `src/core/config/config.service.test.ts`
- Modify: `src/mainview/services/config.service.ts`

**Step 1: Write failing config tests**
- Add tests asserting defaults and normalization for:
  - `indexing.watch.debounceMs`
  - `indexing.reconcile.enabled/intervalMs`
  - `indexing.worker.concurrency/batchSize`
  - `indexing.retry.maxAttempts/backoffMs`
  - `retrieval.hybrid.ftsTopN/vectorTopK/rerankTopN`

**Step 2: Run tests to confirm failure**
Run: `bun test src/core/config/config.service.test.ts`
Expected: missing property/default assertions fail.

**Step 3: Implement minimal config changes**
- Extend config types.
- Add default values and normalization in config service.
- Keep backward compatibility for existing config files.

**Step 4: Re-run tests**
Run: `bun test src/core/config/config.service.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/core/config/config.types.ts src/core/config/config.service.ts src/core/config/config.service.test.ts src/mainview/services/config.service.ts
git commit -m "feat: add indexing and hybrid retrieval runtime config"
```

### Task 2: Introduce SQLite Metadata Repository + Migrations

**Files:**
- Create: `src/core/indexing/metadata/index-metadata.repository.types.ts`
- Create: `src/core/indexing/metadata/index-metadata.repository.ts`
- Create: `src/core/indexing/metadata/index-metadata.repository.test.ts`

**Step 1: Write failing repository tests**
- schema init creates all tables and indexes
- upsert/get file rows
- upsert/list/delete chunk rows
- enqueue/claim/complete/fail jobs
- FTS insert/search/delete behavior

**Step 2: Run tests to confirm failure**
Run: `bun test src/core/indexing/metadata/index-metadata.repository.test.ts`
Expected: module/files not found or failing assertions.

**Step 3: Implement repository with bun:sqlite**
- Create DB at `${userDataDir}/metadata/index.db`.
- Add migration bootstrap via `meta.schema_version`.
- Implement transactional methods for file/chunk/job/fts/tombstone operations.

**Step 4: Re-run tests**
Run: `bun test src/core/indexing/metadata/index-metadata.repository.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/core/indexing/metadata/index-metadata.repository.types.ts src/core/indexing/metadata/index-metadata.repository.ts src/core/indexing/metadata/index-metadata.repository.test.ts
git commit -m "feat: add sqlite metadata repository for indexing state"
```

### Task 3: Implement Job Scheduler (Debounce + Dedup Rules)

**Files:**
- Create: `src/core/indexing/jobs/index-job.scheduler.types.ts`
- Create: `src/core/indexing/jobs/index-job.scheduler.ts`
- Create: `src/core/indexing/jobs/index-job.scheduler.test.ts`

**Step 1: Write failing scheduler tests**
- coalesce repeated `change` on same path
- `unlink` cancels pending `index` and schedules `delete`
- enqueue includes expected reason/type/path

**Step 2: Run tests to confirm failure**
Run: `bun test src/core/indexing/jobs/index-job.scheduler.test.ts`
Expected: failures due to missing implementation.

**Step 3: Implement scheduler**
- Path-scoped debounce timer map.
- Dedup + cancel semantics via metadata repository job APIs.

**Step 4: Re-run tests**
Run: `bun test src/core/indexing/jobs/index-job.scheduler.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/core/indexing/jobs/index-job.scheduler.types.ts src/core/indexing/jobs/index-job.scheduler.ts src/core/indexing/jobs/index-job.scheduler.test.ts
git commit -m "feat: add indexing job scheduler with debounce and dedupe"
```

### Task 4: Implement Incremental File Processor (indexFile/deleteFile)

**Files:**
- Create: `src/core/indexing/processor/file-index.processor.types.ts`
- Create: `src/core/indexing/processor/file-index.processor.ts`
- Create: `src/core/indexing/processor/file-index.processor.test.ts`
- Modify: `src/core/indexing/indexing.service.ts`

**Step 1: Write failing processor tests**
- unchanged file quick-skip by mtime/size
- added chunk -> embed + vector upsert + DB upsert + FTS upsert
- changed chunk -> re-embed + vector update semantics
- removed chunk -> vector delete + DB/FTS delete
- deleteFile clears vector + metadata and marks deleted

**Step 2: Run tests to confirm failure**
Run: `bun test src/core/indexing/processor/file-index.processor.test.ts`
Expected: failures.

**Step 3: Implement processor logic**
- Parse stream/small file using existing parser interfaces.
- Build deterministic chunk identity and hashes.
- Diff old/new chunks and apply minimal updates.
- Add retry-aware error returns.

**Step 4: Re-run tests**
Run: `bun test src/core/indexing/processor/file-index.processor.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/core/indexing/processor/file-index.processor.types.ts src/core/indexing/processor/file-index.processor.ts src/core/indexing/processor/file-index.processor.test.ts src/core/indexing/indexing.service.ts
git commit -m "feat: add incremental file processor for chunk-level updates"
```

### Task 5: Implement Job Worker + Recovery Loop

**Files:**
- Create: `src/core/indexing/worker/index-worker.types.ts`
- Create: `src/core/indexing/worker/index-worker.ts`
- Create: `src/core/indexing/worker/index-worker.test.ts`
- Modify: `src/core/indexing/indexing.service.types.ts`
- Modify: `src/core/indexing/indexing.service.ts`

**Step 1: Write failing worker tests**
- claims pending jobs with concurrency cap
- path-level serialization for same file
- retry with backoff until max attempts
- startup recovery (`running -> pending`)

**Step 2: Run tests to confirm failure**
Run: `bun test src/core/indexing/worker/index-worker.test.ts`
Expected: failures.

**Step 3: Implement worker**
- polling/claim loop against jobs table
- path lock map
- status updates + metrics callbacks

**Step 4: Re-run tests**
Run: `bun test src/core/indexing/worker/index-worker.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/core/indexing/worker/index-worker.types.ts src/core/indexing/worker/index-worker.ts src/core/indexing/worker/index-worker.test.ts src/core/indexing/indexing.service.types.ts src/core/indexing/indexing.service.ts
git commit -m "feat: add indexing worker with retries and crash recovery"
```

### Task 6: Add Watcher + Reconcile Integration in IndexingService

**Files:**
- Modify: `src/core/indexing/indexing.service.ts`
- Modify: `src/core/indexing/indexing.service.test.ts`

**Step 1: Write failing tests**
- watcher event creates expected jobs
- reconcile computes `S-D`, `D-S`, changed intersection
- `runIncremental` enqueues jobs instead of full rebuild

**Step 2: Run tests to confirm failure**
Run: `bun test src/core/indexing/indexing.service.test.ts`
Expected: failures.

**Step 3: Implement integration**
- wire scheduler + worker + metadata repo into service
- implement reconcile scan and job enqueue
- keep status store updated with queue/running/current file/error counts

**Step 4: Re-run tests**
Run: `bun test src/core/indexing/indexing.service.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/core/indexing/indexing.service.ts src/core/indexing/indexing.service.test.ts
git commit -m "feat: wire watcher and reconcile into incremental indexing service"
```

### Task 7: Extend Retrieval to Hybrid Recall + Unified Rerank

**Files:**
- Modify: `src/core/retrieval/retrieval.service.types.ts`
- Modify: `src/core/retrieval/retrieval.service.ts`
- Create: `src/core/retrieval/retrieval.hybrid.test.ts`
- Optionally Modify: `src/core/vector/vector.repository.types.ts` (if extra fetch API needed)

**Step 1: Write failing hybrid retrieval tests**
- vector and FTS called in parallel
- merge by `chunk_id` and dedupe
- reranker receives merged list once
- final output honors `rerankTopN`

**Step 2: Run tests to confirm failure**
Run: `bun test src/core/retrieval/retrieval.hybrid.test.ts`
Expected: failures.

**Step 3: Implement hybrid retrieval**
- Add FTS provider dependency from metadata repository.
- Combine with vector rows and normalize score/fields.

**Step 4: Re-run tests**
Run: `bun test src/core/retrieval/retrieval.service.test.ts src/core/retrieval/retrieval.hybrid.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/core/retrieval/retrieval.service.types.ts src/core/retrieval/retrieval.service.ts src/core/retrieval/retrieval.hybrid.test.ts
git commit -m "feat: add hybrid vector and fts retrieval with unified rerank"
```

### Task 8: Wire App Container + Startup Lifecycle

**Files:**
- Modify: `src/bun/app.container.ts`
- Modify: `src/bun/app.container.test.ts`
- Modify: `src/bun/index.ts`

**Step 1: Write failing lifecycle tests**
- metadata db initialized at startup
- worker starts/stops with app lifecycle
- startup recovery job reset occurs

**Step 2: Run tests to confirm failure**
Run: `bun test src/bun/app.container.test.ts`
Expected: failures.

**Step 3: Implement wiring**
- register metadata repo/scheduler/worker in DI
- boot watcher/reconcile loop if enabled
- graceful shutdown for worker/watcher/db

**Step 4: Re-run tests**
Run: `bun test src/bun/app.container.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/bun/app.container.ts src/bun/app.container.test.ts src/bun/index.ts
git commit -m "feat: wire sqlite indexing pipeline into app lifecycle"
```

### Task 9: Surface Extended Index Runtime Status in Home UI

**Files:**
- Modify: `src/core/indexing/indexing.service.types.ts`
- Modify: `src/mainview/components/indexing/IndexStatusCard.tsx`
- Modify: `src/mainview/components/indexing/IndexStatusCard.test.tsx`
- Modify: `src/mainview/services/bun.rpc.ts`

**Step 1: Write failing UI tests**
- shows queue depth/running workers/current file/last reconcile
- shows recent failure summary

**Step 2: Run tests to confirm failure**
Run: `bun test src/mainview/components/indexing/IndexStatusCard.test.tsx`
Expected: failures.

**Step 3: Implement UI + RPC mapping**
- extend status payload and render card sections.

**Step 4: Re-run tests**
Run: `bun test src/mainview/components/indexing/IndexStatusCard.test.tsx`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/core/indexing/indexing.service.types.ts src/mainview/components/indexing/IndexStatusCard.tsx src/mainview/components/indexing/IndexStatusCard.test.tsx src/mainview/services/bun.rpc.ts
git commit -m "feat: expose queue and reconcile metrics in index status ui"
```

### Task 10: End-to-End Verification + Docs

**Files:**
- Modify: `README.md` (or existing setup doc)
- Create/Modify: `docs/plans/verification-checklist-local-rag-mcp.md` (if used as active checklist)

**Step 1: Add E2E regression tests (or scripted verification)**
- full rebuild produces files/chunks/fts/vector rows
- file edit updates only changed chunk
- file delete removes vector + metadata
- reconcile repairs dropped watcher event

**Step 2: Run full verification suite**
Run:
- `bun test src/core/indexing src/core/retrieval src/core/vector src/bun`
- `bun test`
Expected: PASS (noting known Bun post-run panic if it appears).

**Step 3: Update docs**
- configuration keys
- recovery semantics
- known limits

**Step 4: Commit**
```bash
git add README.md docs/plans/verification-checklist-local-rag-mcp.md
git commit -m "docs: add incremental indexing and hybrid retrieval operations guide"
```

### Task 11: Final Review and Integration

**Files:**
- No code changes required unless review finds issues

**Step 1: Request code review**
- Use `superpowers:requesting-code-review`.

**Step 2: Address findings with small follow-up commits**
- one finding per commit.

**Step 3: Final verification**
Run: `bun test`
Expected: pass in assertions; if Bun panic occurs post-run, include explicit note.

**Step 4: Merge prep**
- Use `superpowers:finishing-a-development-branch`.

