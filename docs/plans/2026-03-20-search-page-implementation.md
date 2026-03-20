# Search Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a real search page that performs debounced live search, renders result cards, and shows a full markdown preview for the selected result.

**Architecture:** Add a shared search request/response type and Bun RPC request, expose a renderer search API from `App.tsx`, and implement the interactive UI in `SearchPanel` with request ordering guards and preview fetch state. Reuse the existing markdown viewer and file markdown RPC for preview.

**Tech Stack:** TypeScript, React, Electrobun RPC, Bun tests, existing markdown viewer

---

### Task 1: Add shared search API and Bun bridge tests

**Files:**
- Modify: `src/shared/files.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/bun/index.ts`
- Test: `src/renderer/App.test.tsx`

**Step 1: Write the failing test**

Add tests for:
- `/search` route still renders search panel.
- app shell receives a search-capable API contract.

**Step 2: Run test to verify it fails**

Run: `bun test src/renderer/App.test.tsx`
Expected: FAIL because search API is not yet wired through app props and RPC.

**Step 3: Write minimal implementation**

Add shared search request/response types and Bun/renderer RPC mappings.

**Step 4: Run test to verify it passes**

Run: `bun test src/renderer/App.test.tsx`
Expected: PASS

### Task 2: Add failing SearchPanel interaction tests

**Files:**
- Create: `src/renderer/components/shell/search-panel.test.tsx`
- Modify: `src/renderer/components/shell/search-panel.tsx`
- Modify: `src/renderer/components/shell/types.ts`
- Modify: `src/renderer/components/shell/app-shell.tsx`
- Modify: `src/renderer/components/shell/app-shell-layout.test.tsx`

**Step 1: Write the failing test**

Add tests covering:
- empty state before input
- debounced search call after typing
- rendering result cards from a search response
- auto-selecting first result and loading preview

**Step 2: Run test to verify it fails**

Run: `bun test src/renderer/components/shell/search-panel.test.tsx src/renderer/components/shell/app-shell-layout.test.tsx`
Expected: FAIL because search panel is still static.

**Step 3: Write minimal implementation**

Implement interactive search panel state and wire search API into shell props.

**Step 4: Run test to verify it passes**

Run: `bun test src/renderer/components/shell/search-panel.test.tsx src/renderer/components/shell/app-shell-layout.test.tsx`
Expected: PASS

### Task 3: Add stale-response protection and preview error handling tests

**Files:**
- Modify: `src/renderer/components/shell/search-panel.test.tsx`
- Modify: `src/renderer/components/shell/search-panel.tsx`

**Step 1: Write the failing test**

Add tests for:
- older search response cannot overwrite a newer query
- preview error renders an error state instead of crashing

**Step 2: Run test to verify it fails**

Run: `bun test src/renderer/components/shell/search-panel.test.tsx`
Expected: FAIL until request ordering and preview state handling are implemented.

**Step 3: Write minimal implementation**

Add request sequence guards and preview loading/error states.

**Step 4: Run test to verify it passes**

Run: `bun test src/renderer/components/shell/search-panel.test.tsx`
Expected: PASS

### Task 4: Final verification

**Files:**
- Modify: files above

**Step 1: Run focused verification**

Run: `bun test src/renderer/App.test.tsx src/renderer/components/shell/search-panel.test.tsx src/renderer/components/shell/app-shell-layout.test.tsx`
Expected: PASS

**Step 2: Commit**

```bash
git add docs/plans/2026-03-20-search-page-design.md docs/plans/2026-03-20-search-page-implementation.md src/shared/files.ts src/bun/index.ts src/renderer/App.tsx src/renderer/App.test.tsx src/renderer/components/shell/search-panel.tsx src/renderer/components/shell/search-panel.test.tsx src/renderer/components/shell/app-shell.tsx src/renderer/components/shell/types.ts src/renderer/components/shell/app-shell-layout.test.tsx
git commit -m "feat(renderer): add live search page"
```
