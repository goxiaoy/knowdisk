# Python Index SQLite Search Design

## Goal

Refactor the Python indexing runtime so queue state is persisted in SQLite, parsed chunks are stored in SQLite plus FTS5, and search combines FTS recall with vector recall before reranking. The search response must expose intermediate results for debugging.

## Scope

This design covers the Python worker indexing stack only. It does not include renderer debug UI or new end-user filters beyond `titleOnly`.

## Architecture

The Python indexing stack will be split into three storage concerns:

- Queue state in SQLite
- Chunk metadata and FTS documents in SQLite
- Embeddings in `zvec`

`IndexService` remains the orchestration layer. On indexing, it parses content, writes parser markdown artifacts, writes chunk rows into SQLite/FTS, writes embeddings into `zvec`, and updates vector/index status. On search, it delegates to a new search service that performs FTS recall and vector recall, merges candidates, reranks them, and returns a debug-friendly payload.

## Data Model

### Queue Storage

SQLite-backed queue state will store at least:

- `job_id`
- `node_id`
- `node_name`
- `status`
- `attempt_count`
- `last_error`
- `created_at`
- `updated_at`

The in-process worker loop can still execute serially, but SQLite becomes the source of truth for queue depth and persisted state.

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

The Python search request must accept `titleOnly`. The Python search response shape must expand from a plain result list to the multi-stage debug payload.

## Testing Strategy

Add tests for:

- SQLite-backed queue persistence and snapshot semantics
- SQLite chunk store and FTS queries
- Search pipeline merge/rerank/debug payload
- `titleOnly` behavior
- End-to-end indexing plus search through Python integration tests

Tests should keep using local temporary directories so no repository-root state is created.
