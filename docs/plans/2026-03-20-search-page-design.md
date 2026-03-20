# Search Page Design

## Goal

Add a real search page where the user types a query, the app calls backend search in near real time, and the page renders result cards plus an in-page markdown preview for the selected result.

## Current State

- The renderer already has a `/search` route and sidebar entry.
- [search-panel.tsx](/Users/goxy/projects/knowdisk/src/renderer/components/shell/search-panel.tsx) is still static placeholder UI.
- The Python worker already exposes `search(query, titleOnly)` and returns `debug.finalResults`.
- The renderer already has `getFileMarkdown(nodeId)` and a reusable markdown preview component.

So the missing work is not search infrastructure. It is wiring the frontend and Bun RPC boundary so the route becomes interactive.

## Decision

Implement a search page with:

- debounced live search
- request race protection
- result list on the left
- full markdown preview on the right

The selected result preview will stay inside the search page. The page will not navigate to `/files`.

## UX

### Layout

Search page becomes a two-column layout:

- left column: search input, status text, result list
- right column: selected result preview

On narrow screens it can stack vertically.

### Search behavior

- Query changes trigger search after a short debounce of about 250ms.
- Empty query clears results and preview state.
- When results arrive, the first result becomes selected automatically.
- Selecting a result fetches full markdown using `getFileMarkdown(nodeId)` and renders it in the preview pane.

### States

- idle: empty query prompt
- searching: spinner/text while query is in flight
- no results: query ran but returned nothing
- results loaded: cards rendered
- preview loading: result selected, markdown fetch in flight
- preview error: markdown fetch failed

## Data Flow

1. User types in the search input.
2. Search page updates local query state.
3. After debounce, renderer calls Bun RPC `search({ query, titleOnly })`.
4. Bun bridges the call to the Python worker `search` request.
5. Renderer receives search payload and stores `finalResults`.
6. Renderer auto-selects the first result for the active query.
7. Renderer calls existing `getFileMarkdown(nodeId)` for the selected result.
8. Markdown preview renders on the right.

## API Shape

Add shared request/response types and Bun RPC mapping for search.

Recommended shared types:

```ts
export type SearchRequest = {
  query: string;
  titleOnly?: boolean;
};

export type SearchResult = {
  chunkId?: string;
  nodeId: string;
  mountId?: string;
  sourceRef?: string;
  name?: string;
  title?: string;
  text?: string;
  score?: number;
  ftsScore?: number;
  vectorScore?: number;
  rerankScore?: number;
  matchedBy?: string[];
};

export type SearchResponse = {
  query: string;
  titleOnly: boolean;
  finalResults: SearchResult[];
};
```

The renderer does not need the whole Python debug payload. Flatten to `finalResults` at the Bun boundary unless later debugging proves the extra detail is useful in the UI.

## Concurrency and Correctness

Live search needs request ordering protection.

Use a monotonically increasing request id in the search panel:

- each debounced search stores `requestId`
- only the latest response is allowed to update results
- same rule for markdown preview fetches

This prevents stale slow responses from overwriting newer user input.

## Testing

### Renderer tests

- search page renders empty state on `/search`
- typing triggers debounced search
- result cards render from backend response
- first result auto-selects
- preview loads via `getFileMarkdown`
- stale older search response does not replace newer results

### Bun/RPC tests

- Bun search request maps to python worker `search`
- returned payload shape matches renderer expectations

## Trade-offs

### Why debounce instead of every keystroke immediately?

True per-keystroke search is possible, but 250ms debounce gives the same user perception while preventing unnecessary duplicate requests and reducing race conditions.

### Why fetch full markdown on selection instead of rendering result snippets only?

Snippets are useful for scanning, but the user explicitly wants in-page preview. Reusing the existing markdown artifact path is simpler and provides full context immediately after selection.

### Why not navigate to files?

That breaks the search workflow and adds route coordination that is not needed for the first working version.
