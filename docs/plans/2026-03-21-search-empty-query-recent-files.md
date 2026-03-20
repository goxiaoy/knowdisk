# Search Empty Query Recent Files Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the search page show recently modified files for an empty query while preserving the existing Python-backed search flow for non-empty queries.

**Architecture:** Keep a single renderer-facing `search()` API, but split execution by query emptiness in the Bun layer. Empty queries are resolved from VFS file metadata sorted by recency; non-empty queries continue to call the Python search service. The renderer continues to consume a single `SearchResponse` shape and reuses the existing preview path.

**Tech Stack:** Bun, TypeScript, React, Bun test, existing VFS repository APIs

---

### Task 1: Add Bun-side tests for empty-query recent files

**Files:**
- Modify: `src/bun/index.ts`
- Test: `src/bun/index.test.ts`

**Step 1: Write the failing test**

Add focused tests covering:

- `search({ query: "" })` returns recent file results sorted by `mtimeMs` descending
- `updatedAtMs` is used when `mtimeMs` is null
- folders and mounts are excluded
- empty-query search does not call the Python worker transport

Use real file-node shaped fixtures with distinct `mtimeMs` and `updatedAtMs` values.

**Step 2: Run test to verify it fails**

Run:

```bash
bun test src/bun/index.test.ts
```

Expected: FAIL because empty search currently returns `finalResults: []`.

**Step 3: Write minimal implementation**

In `src/bun/index.ts`, extract the empty-query branch into a helper that:

- pulls file nodes from the VFS repository
- computes a sortable recency timestamp from `mtimeMs ?? updatedAtMs`
- sorts descending
- slices to a fixed limit
- maps nodes into `SearchResult`

**Step 4: Run test to verify it passes**

Run:

```bash
bun test src/bun/index.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/bun/index.ts src/bun/index.test.ts
git commit -m "feat(search): return recent files for empty query"
```

### Task 2: Preserve non-empty search behavior

**Files:**
- Modify: `src/bun/index.test.ts`

**Step 1: Write the failing test**

Add a test proving that non-empty `search({ query: "alpha" })` still delegates to the Python worker and returns mapped `finalResults`.

**Step 2: Run test to verify it fails**

Run:

```bash
bun test src/bun/index.test.ts -t "delegates non-empty search to python worker"
```

Expected: FAIL only if the new empty-query branch accidentally intercepts non-empty queries.

**Step 3: Write minimal implementation**

Adjust the empty-query check to only intercept `query.trim() === ""`.

**Step 4: Run test to verify it passes**

Run:

```bash
bun test src/bun/index.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/bun/index.ts src/bun/index.test.ts
git commit -m "test(search): preserve non-empty python search path"
```

### Task 3: Update search panel behavior for empty queries

**Files:**
- Modify: `src/renderer/components/shell/search-panel.tsx`
- Test: `src/renderer/components/shell/search-panel.test.tsx`

**Step 1: Write the failing test**

Add renderer tests covering:

- initial render triggers empty-query search and shows returned recent files
- clearing an existing query returns to recent files
- the old "Type a query" empty state is not shown for the empty-query flow

Use an `api.search` mock that returns a non-empty result set for `query: ""`.

**Step 2: Run test to verify it fails**

Run:

```bash
bun test src/renderer/components/shell/search-panel.test.tsx
```

Expected: FAIL because the panel currently short-circuits empty queries locally and never calls `api.search`.

**Step 3: Write minimal implementation**

In `search-panel.tsx`:

- remove the local early-return that clears state for empty queries
- let empty queries flow through `api.search`
- update the empty-state rendering so it only appears when there are no recent-file results and no loading/error state

Keep request de-duping and preview loading behavior unchanged.

**Step 4: Run test to verify it passes**

Run:

```bash
bun test src/renderer/components/shell/search-panel.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/renderer/components/shell/search-panel.tsx src/renderer/components/shell/search-panel.test.tsx
git commit -m "feat(search): show recent files for empty query"
```

### Task 4: Run focused regression coverage

**Files:**
- Modify: none
- Test: `src/bun/index.test.ts`
- Test: `src/renderer/components/shell/search-panel.test.tsx`
- Test: `src/renderer/App.test.tsx`
- Test: `src/renderer/components/shell/app-shell-layout.test.tsx`

**Step 1: Run focused tests**

Run:

```bash
bun test src/bun/index.test.ts src/renderer/components/shell/search-panel.test.tsx src/renderer/App.test.tsx src/renderer/components/shell/app-shell-layout.test.tsx
```

Expected: PASS.

**Step 2: Review for accidental UI regressions**

Confirm:

- search page still preserves state across route switches
- selecting a recent result still loads preview
- non-empty search still renders search results

**Step 3: Commit**

```bash
git add docs/plans/2026-03-21-search-empty-query-recent-files-design.md docs/plans/2026-03-21-search-empty-query-recent-files.md
git commit -m "docs(search): plan empty-query recent files behavior"
```
