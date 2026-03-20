# Python Index SQLite Search Design

## Goal

Refactor the Python indexing runtime so indexing requests are persisted in a real FIFO SQLite queue, parsed chunks are stored in SQLite plus FTS5, and search combines FTS recall with vector recall before reranking. The search response must expose intermediate results for debugging.

## Scope

This design covers the Python worker indexing stack only. It does not include renderer debug UI or new end-user filters beyond `titleOnly`.

## Architecture

The Python indexing stack will be split into three storage concerns:

- FIFO jobs and node intent state in SQLite
- Chunk metadata and FTS documents in SQLite
- Embeddings in `zvec`

`IndexService` remains the orchestration layer for the actual indexing work. Bun-facing RPC handlers only acknowledge requests and persist queue intent in SQLite. A background worker owned by the Python runtime wakes on new work, reclaims orphaned jobs on startup, claims FIFO jobs serially, collapses outdated node intents, and executes the latest valid work through `IndexService`. On indexing, `IndexService` parses content, writes parser markdown artifacts, writes chunk rows into SQLite/FTS, writes embeddings into `zvec`, and updates vector/index status. On search, it delegates to a new search service that performs FTS recall and vector recall, merges candidates, reranks them, and returns a debug-friendly payload.

## Data Model

### Queue Storage

Queue persistence will use two tables:

1. `index_jobs`
- `job_id`
- `node_id`
- `job_type` (`index` | `delete`)
- `payload_json`
- `status` (`queued` | `running` | `done` | `failed` | `cancelled`)
- `created_at`
- `updated_at`
- `started_at`
- `finished_at`
- `error`

2. `index_node_state`
- `node_id`
- `latest_job_id`
- `desired_type`
- `payload_json`
- `version`
- `updated_at`

`index_jobs` preserves FIFO order and execution history. `index_node_state` records the latest effective intent for each node so outdated queued jobs can be skipped at execution time.

This allows:
- FIFO dequeue order
- node-local request collapsing
- `index_node` requests to be coalesced
- `delete_node` requests to supersede stale `index_node` work
- queue requests to return immediately while indexing continues asynchronously

`queueDepth` will be computed directly from SQLite:
- `queuedCount = count(status='queued')`
- `runningCount = count(status='running')`

The current `queueDepth` UI field should map to `queuedCount`.

### Chunk Storage

SQLite chunk storage will include:

- `chunk_id`
- `node_id`
- `mount_id`
- `source_ref`
- `name`
- `title`
- `text`
- `created_at`
- `updated_at`

An FTS5 virtual table will index `title` and `text`. `titleOnly=true` searches only the `title` column.

### Vector Storage

Vector embeddings remain in `zvec`. The vector backend stays independent from SQLite so embedding storage and ANN retrieval stay specialized.

## Search Pipeline

Search will execute in five stages:

1. FTS recall from SQLite FTS5
2. Vector recall from `zvec`
3. Candidate merge by `chunk_id`
4. Reranking using the local reranker runtime
5. Final truncation into top-k results

The response will include:

- `ftsResults`
- `vectorResults`
- `mergedCandidates`
- `rerankedResults`
- `finalResults`

Each result row will preserve:

- `chunkId`
- `nodeId`
- `name`
- `title`
- `text`
- `sourceRef`

Debug-only fields will include:

- `ftsScore`
- `vectorScore`
- `rerankScore`
- `matchedBy`

## Protocol Changes

The Python search request must accept `titleOnly`. The Python search response shape must expand from a plain result list to the multi-stage debug payload. Queue-triggering RPCs remain request/acknowledge operations; actual indexing becomes asynchronous behind the runtime-owned FIFO worker. `index_node` and `delete_node` should not synchronously execute indexing work in the RPC handler.

## Testing Strategy

Add tests for:

- FIFO queue insertion, dequeue, and cancellation semantics
- enqueue-only queue behavior and runtime-owned worker execution
- orphaned `running` job recovery on startup
- node intent collapsing (`index` coalescing, `delete` superseding stale `index`)
- SQLite-backed queue depth and running count semantics
- SQLite chunk store and FTS queries
- Search pipeline merge/rerank/debug payload
- `titleOnly` behavior
- End-to-end indexing plus search through Python integration tests

Tests should keep using local temporary directories so no repository-root state is created.
