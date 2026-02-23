# Incremental Indexing + Hybrid Retrieval Design

**Date:** 2026-02-23
**Project:** Know Disk

## Goal
Implement complete directory indexing with robust incremental updates, using SQLite as metadata truth and hybrid retrieval (vector + FTS) merged before reranking.

## Current Baseline
- Indexing currently rebuilds by walking sources and re-indexing files.
- `runIncremental` and `runScheduledReconcile` are placeholders.
- Vector store exists (`zvec`) and retrieval/reranker already work.
- Index status is subscribable and surfaced in UI.

## Core Truths
1. File system is source of truth.
2. SQLite metadata database tracks file/chunk/indexing state.
3. Vector store is a rebuildable cache storing embedding by chunk identity.

## Selected Architecture
Use a single-process, transaction-driven indexing pipeline:
- `IndexMetadataRepository` (SQLite) is the state machine.
- `IndexJobScheduler` receives watcher/reconcile/manual triggers and writes deduped jobs.
- `IndexWorker` consumes jobs with bounded concurrency.
- `IndexingService` orchestrates full rebuild, incremental, reconcile, and exposes runtime status.
- `RetrievalService` runs parallel vector + FTS recall and applies one rerank stage.

## SQLite Schema
Database path: `${userDataDir}/metadata/index.db`

### files
- `file_id TEXT PRIMARY KEY`
- `path TEXT UNIQUE NOT NULL`
- `size INTEGER NOT NULL`
- `mtime_ms INTEGER NOT NULL`
- `inode INTEGER NULL`
- `status TEXT NOT NULL` (`indexed|indexing|failed|deleted|ignored`)
- `last_index_time_ms INTEGER`
- `last_error TEXT`
- `created_at_ms INTEGER NOT NULL`
- `updated_at_ms INTEGER NOT NULL`
- Indexes: `idx_files_status`, `idx_files_mtime`

### chunks
- `chunk_id TEXT PRIMARY KEY`
- `file_id TEXT NOT NULL`
- `source_path TEXT NOT NULL`
- `start_offset INTEGER`
- `end_offset INTEGER`
- `chunk_hash TEXT NOT NULL`
- `token_count INTEGER`
- `updated_at_ms INTEGER NOT NULL`
- `UNIQUE(file_id, start_offset, end_offset)`
- Indexes: `idx_chunks_file`, `idx_chunks_hash`

### fts_chunks (FTS5)
- Virtual table with columns:
  - `chunk_id UNINDEXED`
  - `file_id UNINDEXED`
  - `source_path UNINDEXED`
  - `text`
- Tokenizer: `unicode61`

### jobs
- `job_id TEXT PRIMARY KEY`
- `path TEXT NOT NULL`
- `job_type TEXT NOT NULL` (`index|delete|reconcile`)
- `status TEXT NOT NULL` (`pending|running|done|failed|canceled`)
- `reason TEXT NOT NULL`
- `attempt INTEGER NOT NULL DEFAULT 0`
- `error TEXT`
- `next_run_at_ms INTEGER NOT NULL`
- `created_at_ms INTEGER NOT NULL`
- `updated_at_ms INTEGER NOT NULL`
- Scheduled index: `idx_jobs_sched(status, next_run_at_ms)`

### tombstones
- `path TEXT PRIMARY KEY`
- `deleted_time_ms INTEGER NOT NULL`

### meta
- `key TEXT PRIMARY KEY`
- `value TEXT NOT NULL`
- includes `schema_version`

## Data Flows

### Watcher Flow
- Watch enabled source paths using `chokidar`.
- Events `add/change/unlink` are debounced per path.
- Scheduler converts events into deduped jobs.

### Reconcile Flow
- Periodic scan computes:
  - `S - D`: missing files -> `index`
  - `D - S`: deleted files -> `delete`
  - changed intersection -> `index`
- Creates repair jobs and returns repaired count.

### indexFile(path)
- Set `files.status = indexing`.
- Parse file (streaming for large files).
- Chunk into spans and compute `chunk_hash`.
- Diff against existing DB chunks:
  - added/changed -> embed + vector upsert + upsert chunk row + upsert FTS row
  - removed -> vector delete + delete chunk row + delete FTS row
- Finalize file row with `indexed` status and timestamps.

### deleteFile(path)
- Load file/chunk rows by path.
- Delete vectors by `chunk_id`.
- Delete chunk/FTS rows.
- Mark file `deleted` and write tombstone.

### Startup Recovery
- `jobs.status=running` -> `pending`.
- `files.status=indexing` from interrupted run are requeued.

## Hybrid Retrieval
- At query time run in parallel:
  - Vector search (`topK`)
  - FTS5 `MATCH` (`topN`)
- Merge by `chunk_id`, dedupe, and rerank once.
- Return unified `RetrievalResult`.

## Error Handling
- File-level isolation: one file failure does not stop pipeline.
- Retry policy: max 3 attempts, backoff `1s/5s/20s`.
- Idempotent job processing for repeated events.
- DB operations transactional; vector operations reconciled by retry and follow-up repair.

## Observability
Structured pino logs for:
- job enqueue/start/success/fail/retry
- rebuild/reconcile start/finish
- watcher event received/coalesced
- per-file chunk add/update/delete counts

## Config Additions
- `indexing.watch.debounceMs` (default 500)
- `indexing.reconcile.enabled` (default true)
- `indexing.reconcile.intervalMs` (default 900000)
- `indexing.worker.concurrency` (default 2)
- `indexing.worker.batchSize` (default 64)
- `indexing.retry.maxAttempts` (default 3)
- `indexing.retry.backoffMs` (default `[1000,5000,20000]`)
- `retrieval.hybrid.ftsTopN` (default 30)
- `retrieval.hybrid.vectorTopK` (default 20)
- `retrieval.hybrid.rerankTopN` (default 10)

## Non-Goals (This Iteration)
- Content-anchor diff algorithm (rolling hash anchors)
- Advanced parser coverage beyond current supported types
- Remote/distributed queue execution
