# Python Sidecar Indexing Design

**Date:** 2026-03-17

## Goal

Replace the current TypeScript-owned `model`, `parser`, and `indexing/vector` runtime with a Python sidecar process while keeping the desktop shell, VFS, and renderer RPC in Bun/TypeScript.

The application should start a Python worker when the desktop app launches. When VFS node events require indexing, the Bun main process should delegate the work to Python. The Python sidecar should:

- own model lifecycle and model status
- parse files asynchronously
- route complex documents through `docling`
- write vector data into zvec
- own index and vector status for the UI

## Scope

In scope:

- start and supervise a single Python sidecar from the Bun main process
- replace TypeScript `model`, `parser`, and `indexing` runtime ownership with Python
- keep VFS mounting, sync, and node event handling in TypeScript
- delegate `index_node`, `delete_node`, `rebuild_all`, `search`, and status retrieval to Python
- expose Python-owned `model`, `index`, and `vector` status to the renderer
- use `docling` for complex document parsing
- keep a lightweight parser path for simple text-like files

Out of scope:

- moving VFS provider logic to Python
- changing renderer architecture beyond status and RPC adaptation
- building durable task replay for unfinished in-flight indexing work
- defining the full production packaging workflow for Python dependencies in this design doc

## Confirmed Decisions

- Architecture boundary: Bun/TypeScript keeps VFS and UI integration; Python owns model, parsing, indexing queue, and vector persistence
- Process communication: `stdio` JSON-RPC
- Indexing semantics: incremental indexing is serialized; full rebuild uses bounded concurrency
- Model ownership: Python owns the actual model service, not just mirrored status
- Parsing strategy: `docling` is used for complex formats, while simple text-like files use a lightweight parser path

## Current State

Today the Bun main process directly constructs and owns:

- `createModelService(...)`
- `createParserService(...)`
- `createIndexingServiceFromConfig(...)`
- zvec-backed vector repository access

The renderer reads derived status through Bun RPC and does not directly manage indexing internals. VFS node hooks currently trigger indexing inside the same TypeScript process. This design preserves that high-level flow but moves the execution runtime behind a Python boundary.

## Proposed Architecture

### Responsibilities kept in Bun/TypeScript

- application startup and shutdown
- window lifecycle and renderer RPC
- VFS providers, repository, sync, and node event hooks
- Python process creation, health supervision, and restart policy
- protocol translation between renderer-facing RPC and Python-side requests/events

### Responsibilities moved to Python

- local model download, verification, loading, and status
- indexing task queue and queue state
- parsing pipeline
- simple-file parsing path
- `docling` integration for complex documents
- chunk generation and indexing orchestration
- zvec writes and vector DB status
- index status and vector status as the source of truth

### High-level flow

1. The desktop app starts.
2. Bun launches a single Python sidecar and performs a startup handshake.
3. VFS starts as it does today.
4. When VFS content changes, Bun sends an `index_node` request to Python instead of calling a local TypeScript indexing service.
5. Python schedules the task, reads content through Bun-mediated APIs, parses and indexes the file, persists vector data, and emits status updates.
6. Bun forwards those status updates to the renderer using the existing application-facing messaging pattern.

## Transport and Protocol

The sidecar protocol should use line-delimited JSON over `stdio`.

Message categories:

- request: has `id`, `method`, and `params`
- response: has `id`, `result` or `error`
- event: has `type` and `payload`

This keeps the transport easy to debug, stream-friendly, and compatible with a single sidecar process managed entirely by the desktop app.

### Core Bun to Python requests

- `start`
- `shutdown`
- `index_node`
- `delete_node`
- `rebuild_all`
- `search`
- `get_status_snapshot`

### Core Python to Bun events

- `model_status_changed`
- `index_status_changed`
- `vector_status_changed`
- `worker_log`
- `worker_health_changed`

### Reverse requests from Python to Bun

Python should not reimplement VFS. When it needs file content or related metadata, it should request them from Bun.

Required reverse-call surface:

- `read_node_content(nodeId)`
- `get_node_metadata(nodeId)`
- optionally `materialize_node_file(nodeId)` if `docling` performs better against a temporary file path than an in-memory buffer

This keeps VFS as a single implementation in TypeScript and avoids duplicating provider logic in Python.

## Data Flow

### Incremental indexing

1. Bun receives a VFS content update event.
2. Bun sends `index_node(nodeId)` to Python.
3. Python adds the node to the incremental queue.
4. Python requests file bytes and metadata from Bun.
5. Python selects the parser path:
   - simple files: lightweight parser
   - complex files: `docling`
6. Python emits updated index status while parsing and indexing.
7. Python writes chunks and vectors to its owned storage.
8. Python emits updated vector status and final index status.

### Full rebuild

1. Bun sends `rebuild_all`.
2. Python enters rebuild mode.
3. Python enumerates files through Bun-provided metadata traversal inputs or a precomputed file list from Bun.
4. Python processes files with bounded concurrency.
5. Python serializes final repository mutations if zvec or related repositories require single-writer safety.
6. Python emits progress updates throughout the rebuild.

### Delete flow

1. Bun sends `delete_node(nodeId)`.
2. Python clears parser artifacts, FTS records, and vector entries for the node.
3. Python emits updated index and vector status if counts or queue state changed.

## Parsing Strategy

Python uses two parsing paths:

- lightweight parser path for simple text-like formats such as markdown, text, and JSON
- `docling` path for complex formats such as PDF, DOCX, PPTX, XLSX, and image-based inputs where applicable

This split keeps simple documents fast and low-overhead while letting complex documents use the richer document understanding pipeline from `docling`.

The sidecar should produce a normalized chunk shape regardless of parser path so indexing, search, and UI do not depend on parser-specific output.

## Status Model

Python is the source of truth for the following UI-facing status domains:

- `model_status`
- `index_status`
- `vector_status`

TypeScript should only map Python payloads into renderer-safe shared types.

### Model status

Keep the existing general structure:

- phase
- progress percentage
- error
- per-task state for embedding and reranker work

### Index status

Keep the current fields and add queue visibility:

- phase
- scope
- queueDepth
- processedFiles
- totalFiles
- activeNodeName
- error

`queueDepth` is required so the UI can distinguish active work from queued work in the Python sidecar.

### Vector status

Expand beyond the current `chunkCount`-only shape:

- available
- chunkCount
- lastUpdatedAt
- error

This allows the UI to distinguish healthy empty state, worker failure, and stale data.

## Error Handling and Recovery

The Bun main process must treat Python as a supervised dependency.

### Startup failures

If the sidecar cannot start:

- Bun should surface `model/index/vector` as unavailable or errored
- the renderer should receive explicit error state, not inferred absence

### Runtime failures

If the sidecar exits unexpectedly:

- Bun marks Python-owned status domains as unavailable immediately
- Bun attempts bounded restart
- after restart, Bun requests `get_status_snapshot` to repopulate state

### Task recovery

The first version should not persist unfinished task queues for replay.

Rationale:

- the durable asset is the indexed output, not the transient queue
- parser cache, FTS state, and zvec persistence already provide the useful recovery boundary
- persisting queue journals across process crashes adds complexity without clear first-stage payoff

If Python detects storage inconsistency or an unclean shutdown marker on startup, it should trigger or recommend a full rebuild.

## Testing Strategy

### Python unit tests

- parser path selection
- `docling` adapter behavior
- indexing queue transitions
- model service state transitions
- zvec write and delete behavior

### Bun unit tests

- sidecar transport framing
- request timeout and error handling
- process exit and bounded restart behavior
- status payload mapping to shared renderer types

### Integration tests

- Bun sends `index_node`, Python parses and indexes, and renderer-visible status changes follow
- delete and rebuild flows propagate correctly across the process boundary
- sidecar startup snapshot correctly hydrates renderer status

### Packaging validation

- development environment can launch the Python sidecar
- packaged desktop builds can locate Python runtime and dependencies
- `docling` and model dependencies resolve in packaged environments

## Trade-offs

### Why not move VFS to Python now

Keeping VFS in TypeScript avoids duplicating mount logic, provider behavior, and the existing UI/event integration. It reduces migration scope and keeps the rewrite focused on the compute-heavy runtime.

### Why `stdio` instead of local HTTP

`stdio` fits a single desktop-owned sidecar better:

- no port management
- simpler lifecycle coupling
- fewer local networking concerns
- easier shutdown cleanup

### Why Python should own the real model service

If Python only owned mirrored status while TypeScript still owned the actual model runtime, the boundary would be inconsistent and harder to maintain. Moving both service and status together keeps the ownership model coherent.

## Open Implementation Questions

- whether Python should receive file bytes directly or receive temporary file materializations for `docling`-heavy formats
- whether Bun should enumerate rebuild file lists or Python should pull paginated traversal data from Bun
- whether FTS also moves fully into Python storage ownership or remains partially exposed through Bun-side adapters
- how the packaged application will provision the Python runtime and pinned Python dependencies across target platforms

These are implementation-plan questions, not blockers for the architecture decision in this design.

## Recommendation

Implement a Python sidecar owned by the Bun main process using line-delimited JSON over `stdio`, keep VFS and UI integration in TypeScript, and move model lifecycle, parsing, indexing orchestration, and vector persistence fully into Python.

This is the smallest architectural slice that satisfies the rewrite goal while preserving the current desktop app structure.
