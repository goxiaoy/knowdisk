# Chat Add Item Picker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an inline search picker to the chat composer so users can select multiple files, see them as removable chips, and manage the selection without leaving chat.

**Architecture:** Keep the first version local to the renderer chat UI. `AppShell` passes the existing `searchApi` into `ChatPanel`; `ChatPanel` owns picker state, selected item state, and chip removal. The picker reuses the existing search API, including empty-query recent files.

**Tech Stack:** React, TypeScript, Bun test, existing renderer search API

---

### Task 1: Pass search API into ChatPanel

**Files:**
- Modify: `src/renderer/components/shell/app-shell.tsx`
- Modify: `src/renderer/components/shell/chat-panel.tsx`
- Modify: `src/renderer/components/shell/types.ts`
- Test: `src/renderer/components/shell/app-shell-layout.test.tsx`

**Step 1: Write the failing test**

Add an `AppShell` test that renders the chat route with a mocked `searchApi`, opens the chat picker entry point, and proves the chat route can call into the provided `searchApi`.

**Step 2: Run test to verify it fails**

Run:

```bash
bun test src/renderer/components/shell/app-shell-layout.test.tsx
```

Expected: FAIL because `ChatPanel` currently receives no `searchApi`.

**Step 3: Write minimal implementation**

- Extend `ChatPanel` props to accept `searchApi`
- Pass `searchApi` from `AppShell`
- Update shared shell prop types accordingly

**Step 4: Run test to verify it passes**

Run:

```bash
bun test src/renderer/components/shell/app-shell-layout.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/renderer/components/shell/app-shell.tsx src/renderer/components/shell/chat-panel.tsx src/renderer/components/shell/types.ts src/renderer/components/shell/app-shell-layout.test.tsx
git commit -m "refactor(chat): pass search api into chat panel"
```

### Task 2: Add inline picker open/search behavior

**Files:**
- Modify: `src/renderer/components/shell/chat-panel.tsx`
- Create: `src/renderer/components/shell/chat-panel.test.tsx`

**Step 1: Write the failing test**

Add tests covering:

- clicking `Add item` opens the picker
- opening the picker triggers `searchApi.search({ query: "", titleOnly: false })`
- picker renders returned recent-file results
- picker shows loading and error states

**Step 2: Run test to verify it fails**

Run:

```bash
bun test src/renderer/components/shell/chat-panel.test.tsx
```

Expected: FAIL because the current chat panel has no picker state or search behavior.

**Step 3: Write minimal implementation**

In `chat-panel.tsx`:

- add `pickerOpen`, `pickerQuery`, `pickerResults`, `pickerLoading`, and `pickerError`
- open the picker from `Add item`
- call `searchApi.search` when the picker opens and whenever the query changes
- render a compact inline result list

**Step 4: Run test to verify it passes**

Run:

```bash
bun test src/renderer/components/shell/chat-panel.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/renderer/components/shell/chat-panel.tsx src/renderer/components/shell/chat-panel.test.tsx
git commit -m "feat(chat): add inline item picker"
```

### Task 3: Add multi-select chips with dedupe and removal

**Files:**
- Modify: `src/renderer/components/shell/chat-panel.tsx`
- Modify: `src/renderer/components/shell/chat-panel.test.tsx`

**Step 1: Write the failing test**

Extend tests to prove:

- selecting multiple results creates multiple chips
- selecting the same result twice does not duplicate the chip
- clicking a chip remove button deletes only that chip
- chips remain visible while the picker stays open for further selection

**Step 2: Run test to verify it fails**

Run:

```bash
bun test src/renderer/components/shell/chat-panel.test.tsx
```

Expected: FAIL because the picker does not yet store selections.

**Step 3: Write minimal implementation**

Add `selectedItems` state in `chat-panel.tsx`:

- store picked `SearchResult` items
- dedupe by `nodeId`
- render chips above the prompt area
- add per-chip remove buttons

**Step 4: Run test to verify it passes**

Run:

```bash
bun test src/renderer/components/shell/chat-panel.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/renderer/components/shell/chat-panel.tsx src/renderer/components/shell/chat-panel.test.tsx
git commit -m "feat(chat): show removable selected file chips"
```

### Task 4: Run focused regression coverage

**Files:**
- Modify: none
- Test: `src/renderer/components/shell/chat-panel.test.tsx`
- Test: `src/renderer/components/shell/app-shell-layout.test.tsx`
- Test: `src/renderer/App.test.tsx`
- Test: `src/renderer/components/shell/search-panel.test.tsx`

**Step 1: Run focused tests**

Run:

```bash
bun test src/renderer/components/shell/chat-panel.test.tsx src/renderer/components/shell/app-shell-layout.test.tsx src/renderer/App.test.tsx src/renderer/components/shell/search-panel.test.tsx
```

Expected: PASS.

**Step 2: Manual behavior check**

In `bun run dev`, confirm:

- chat `Add item` opens inline picker
- empty picker shows recent files
- multiple files can be selected
- chips show file names
- chips can be removed individually

**Step 3: Commit**

```bash
git add docs/plans/2026-03-21-chat-add-item-picker-design.md docs/plans/2026-03-21-chat-add-item-picker.md
git commit -m "docs(chat): plan add-item picker"
```
