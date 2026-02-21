# Local RAG MCP Desktop Design (v1)

Date: 2026-02-21
Project: knowdisk
Status: Approved

## 1. Scope And Goals

Build a desktop application that:
- lets users configure local folders/files as knowledge sources,
- builds and maintains local RAG indexes from those files,
- exposes MCP tools for external LLM clients (v1 target: Claude Desktop),
- returns Top-K retrieved chunks with metadata (no answer synthesis in v1).

Primary constraints and decisions:
- UI language in generated files/docs/code remains English.
- Retrieval output format: Top-K chunks + metadata.
- Index backend: bundled `zvec`.
- Embedding mode: hybrid (local or cloud provider, configurable).
- Index maintenance: realtime watch + scheduled reconcile + manual triggers.
- Parser architecture: abstraction layer first, v1 parser coverage is text-first.
- Config UX: safe presets by default, advanced options collapsible.

Out of scope for v1:
- built-in final-answer generation,
- plugin marketplace,
- broad non-text parsing (e.g., full PDF/Office) unless added later via parser abstraction.

## 2. Architecture

Recommended architecture: Thin Desktop + Internal Service.

Core modules:
1. Desktop UI (React + Electrobun)
2. Config Service
3. File System Abstraction Layer
4. Indexing Service
5. Retrieval Service
6. MCP Server Service

Design rule:
- UI must not directly manipulate index internals; all operations flow through service interfaces.

## 3. Component Contracts

### 3.1 Config Service

Responsibilities:
- centralized config persistence and validation,
- versioned migrations,
- configuration change notifications.

Contract:
- `getConfig(): AppConfig`
- `updateConfig(patch): ValidationResult`
- `subscribeConfigChanged(listener)`
- `exportConfig()` / `importConfig()`
- `migrateConfig(versionedBlob)`

`AppConfig` (v1 key domains):
- `sources`: include/exclude paths, recursion flags, type rules
- `indexing`: watch enabled, schedule, manual controls
- `embedding`: provider mode (`local | cloud`), model, endpoint, credential references
- `retrieval`: default `topK`, thresholds, result size limits
- `mcp`: enabled flag, server metadata, tool visibility
- `ui`: safe preset state, advanced panel visibility

### 3.2 File System Abstraction Layer

Responsibilities:
- normalize scan/watch/read/stat behavior across OS backends,
- report capability and health for watch mode,
- emit canonical file change events.

Contract:
- `scanSources(config): FileInventory`
- `watchSources(config, onEvent): WatchHandle`
- `readFile(path): Buffer | string`
- `stat(path): FileStat`
- `isWatchSupported(path): WatchCapability`

Canonical events:
- `created`, `updated`, `deleted`, `renamed`

### 3.3 Parser Registry

Responsibilities:
- route files to parser implementation by extension/MIME,
- produce normalized parsed documents.

Contract:
- `resolveParser(fileMeta): Parser`
- `parse(file): ParsedDocument`

v1 built-ins:
- `md`, `txt`, `json`, `yaml/yml`, common code files.

Unsupported type behavior:
- skip with explicit reason (`UNSUPPORTED_TYPE`) visible in logs/UI.

### 3.4 Indexing Service

Responsibilities:
- full rebuild,
- incremental updates from watcher events,
- scheduled consistency reconciliation.

Contract:
- `runFullRebuild(reason)`
- `runIncremental(changes)`
- `runScheduledReconcile()`
- `getIndexStatus()`

Pipeline:
- discover -> parse -> chunk -> embed -> upsert/delete in `zvec`

Record model:
- `Chunk`: `chunk_id`, `source_path`, `content`, `token_count`, `checksum`, `updated_at`
- `EmbeddingRecord`: chunk data + vector + provider/model metadata

### 3.5 Retrieval Service

Responsibilities:
- embed query,
- query `zvec`,
- return deterministic Top-K ranked chunks.

Contract:
- `search(query, options): SearchResult[]`

`SearchResult` fields:
- `chunk_text`, `source_path`, `score`, `chunk_id`, `updated_at`, optional `section_hint`

### 3.6 MCP Server Service

Responsibilities:
- expose local knowledge search to Claude Desktop through MCP.

v1 tool:
- `search_local_knowledge`

Input:
- `query`, optional `top_k`, optional source filters

Output:
- Top-K chunks + metadata only.

## 4. Data Flow

### 4.1 Startup
- load + validate config,
- start MCP service if enabled,
- initialize watch backends,
- register scheduled reconcile,
- run service health check.

### 4.2 Realtime Watch Path (Primary)
- receive change events,
- debounce/coalesce bursts,
- parse/chunk/embed/upsert or delete,
- update status and activity stream.

### 4.3 Scheduled Reconcile (Safety Net)
- take periodic inventory snapshot,
- diff against index manifest,
- repair drift in batch,
- emit reconcile report.

### 4.4 Manual Controls
- Quick Sync (changed candidates only),
- Full Rebuild (reset + rebuild selected scope),
- progress/cancel/retry via UI.

### 4.5 Retrieval Through MCP
- MCP receives query,
- Retrieval Service embeds and searches,
- response returns chunk-level results.

### 4.6 Fallback Strategy
- if watch backend is unsupported/unhealthy:
- source enters scheduled-only mode,
- scheduled reconcile preserves eventual correctness,
- UI indicates degraded state with guidance.

## 5. Error Handling And Reliability

Error domains:
- `CONFIG_ERROR`
- `SOURCE_ACCESS_ERROR`
- `WATCH_BACKEND_ERROR`
- `PARSER_ERROR`
- `EMBEDDING_ERROR`
- `INDEX_WRITE_ERROR`
- `MCP_RUNTIME_ERROR`

Reliability rules:
- at-least-once event processing with idempotent upsert (`checksum`, `chunk_id`),
- retry/backoff for transient provider/index issues,
- dead-letter queue for repeatedly failing files,
- scheduled reconcile ensures eventual consistency.

Health model:
- per-component states: `healthy | degraded | failed`,
- aggregate app health computed from FS/watch/parser/embedding/zvec/MCP.

Observability:
- structured logs with correlation IDs,
- key metrics: files/chunks processed, failure counts, indexing/search latency, drift fixes,
- user-facing activity/issues panel.

Data safety:
- no plain-text secrets in logs,
- keep secrets separated from general config payload,
- prefer two-phase rebuild swaps when feasible.

## 6. Testing Strategy (v1)

Unit:
- config validation/migrations,
- file system abstraction behavior,
- parser routing and normalized outputs,
- chunk determinism/checksum,
- retrieval ranking determinism.

Integration:
- filesystem event -> index state assertions,
- scheduled drift repair,
- local/cloud embedding provider switch validation.

MCP contract:
- tool schema/input/output tests,
- stable error shape for Claude Desktop integration,
- verify retrieval-only semantics.

Reliability:
- watch burst coalescing,
- transient failure retries,
- automatic fallback to scheduled-only mode.

Smoke (packaged desktop):
- first-run setup,
- source add -> index -> MCP query path,
- restart persistence for config/index.

Release gates:
- green unit/integration/MCP suites,
- no critical component in failed state,
- reconcile pass on representative sample workspace.

## 7. Implementation Direction

Selected approach:
- Thin Desktop + Internal Service (recommended option).

Next required step:
- produce a detailed implementation plan using the writing-plans workflow.
