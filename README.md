# Know Disk

Know Disk is a local desktop RAG app built with Electrobun + React. It indexes local source directories into a vector store, keeps index metadata in SQLite, exposes retrieval over UI and MCP, and supports incremental updates with periodic reconcile.

## Stack

- Bun / Electrobun
- React + Tailwind + Vite
- `@zvec/zvec` (vector index)
- `bun:sqlite` (index metadata + FTS5)
- pino (structured logs)

## Development

```bash
# Install deps
bun install

# Dev (bundled assets)
bun run dev

# Dev with HMR
bun run dev:hmr

# Tests
bun test
```

`bun run dev` and `bun run dev:hmr` run with `LOG_LEVEL=debug`.

## Runtime Data Paths

By default (macOS/Linux), Know Disk stores runtime data under:

- `~/.knowdisk/app-config.json`
- `~/.knowdisk/zvec/...` (vector collection)
- `~/.knowdisk/metadata/index.db` (SQLite metadata + FTS)
- `~/.knowdisk/cache/...` (local model caches)

## Indexing Model

Indexing uses three truths:

1. File system is source of truth.
2. SQLite metadata tracks files/chunks/jobs.
3. Vector index is a rebuildable cache of embeddings.

### Incremental behavior

- File changes are enqueued as jobs.
- Worker processes jobs with retry/backoff.
- Chunk-level diff uses hash-based updates.
- Scheduled reconcile scans sources periodically and repairs drift.

## Retrieval

Search uses hybrid recall:

- vector recall from zvec
- keyword recall from SQLite FTS5
- merge + dedupe by `chunkId`
- optional reranker final ordering

## MCP Endpoint

When enabled in config, MCP is exposed via HTTP:

- `http://127.0.0.1:<port>/mcp`

Default port is `3467`.

## Verification

Recommended verification before merge/release:

```bash
bun test
bun run build
bun run dev
```

Record outcomes in `docs/plans/verification-checklist-local-rag-mcp.md`.
