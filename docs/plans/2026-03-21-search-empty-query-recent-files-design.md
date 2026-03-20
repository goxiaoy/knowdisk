# Search Empty Query Recent Files Design

**Goal:** Show useful content when the search page opens or the query is empty by listing recently modified files instead of an empty state.

## Context

The current renderer search flow treats an empty query as a no-op. In [index.ts](/Users/goxy/projects/knowdisk/src/bun/index.ts), `search()` trims the query and returns an empty successful response for `""`. The search UI in [search-panel.tsx](/Users/goxy/projects/knowdisk/src/renderer/components/shell/search-panel.tsx) then renders a "Type a query" empty state.

That behavior is fine for strict search semantics but poor for the page's default UX. The desired behavior is not "search with an empty query", but "show recently modified files" so the page is useful immediately.

## Options Considered

### 1. Force empty queries through Python FTS

Use the existing Python `search` endpoint for empty queries and try to sort by recency.

This is the wrong fit. The Python search path is built for FTS + vector retrieval, not for browsing by filesystem timestamps. It does not currently expose a complete file-level `mtime` ordering surface, and bending it into that role would blur retrieval semantics.

### 2. Query indexed chunks and sort them by file metadata

Return recent content only for files that already have indexed chunks.

This partially works but creates obvious gaps. Files with no chunks, failed indexing, or intentionally skipped parsing would disappear even though they are still recently modified files. That violates the requested behavior.

### 3. Split empty and non-empty search paths

For `query.trim() === ""`, return recent files from the Bun-side VFS layer. For non-empty queries, keep the existing Python search pipeline.

This is the recommended design. It matches the domain cleanly: empty search becomes file discovery, non-empty search remains retrieval.

## Recommended Design

### API behavior

Keep the existing renderer-facing `search(input)` API shape so the UI does not need a second request contract.

When `query.trim() === ""`:

- Do not call the Python worker.
- Build a recent-files result set from VFS file nodes.
- Return `ok: true`, the trimmed query, `titleOnly`, and `finalResults`.

When `query.trim() !== ""`:

- Keep the existing Python search request unchanged.

### Data source

Use Bun-side VFS repository data, because it already has file metadata including:

- `name`
- `sourceRef`
- `mtimeMs`
- `updatedAtMs`
- `mountId`
- `nodeId`

Only file nodes should be included. Mounts and folders should be ignored.

### Sorting

Sort descending by the strongest available recency signal:

1. `mtimeMs` when present
2. `updatedAtMs` as fallback

This preserves filesystem semantics where available while still surfacing files that lack `mtimeMs`.

### Result shape

Return recent items as normal `SearchResult` records so the existing UI can reuse them without branching on a second result type.

Populate:

- `nodeId`
- `mountId`
- `sourceRef`
- `name`
- `title` as the file name
- `text` as a lightweight subtitle, preferably the relative path

Do not fabricate search-specific scores such as `ftsScore`, `vectorScore`, or `rerankScore` for recent files.

### UI behavior

In the search panel:

- On first render with an empty query, request recent files after the debounce window or immediately if debounce is disabled.
- When the query is cleared, show recent files again.
- Remove the current "Type a query to search indexed knowledge" empty state.
- Keep the existing result selection behavior: auto-select the first result and load preview.

This makes the search page useful as a landing surface while preserving the current preview flow.

### Limits

Return a bounded number of recent files. The first implementation should use a small fixed limit, such as 20, to keep the UI responsive and avoid walking excessive state for each empty-query refresh.

### Error handling

If recent-file loading fails:

- Keep the query visible
- Show the existing search error state
- Clear stale results so the page does not imply a successful refresh

## Testing Strategy

### Bun search tests

Add coverage proving that:

- Empty search does not call the Python worker
- Empty search returns file results sorted by `mtimeMs` descending
- `updatedAtMs` is used when `mtimeMs` is null
- Non-file nodes are excluded
- Non-empty search still delegates to the Python worker

### Search panel tests

Add coverage proving that:

- Initial empty query loads recent files
- Clearing a non-empty query returns to recent files
- The first recent item is auto-selected and previewed
- The old empty-state message is no longer shown for the empty query case

## Non-Goals

- No changes to Python search ranking
- No changes to FTS behavior
- No persistence of recent-file history beyond current VFS metadata
- No separate "Recent" page or tab
