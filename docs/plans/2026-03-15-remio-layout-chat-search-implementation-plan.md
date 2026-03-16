# Remio-Style Chat Search Shell Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a route-driven Remio-style renderer shell with left navigation (`Chat`, `Search`) and `Knowledge Base -> Files`, defaulting to chat.

**Architecture:** Keep implementation local to renderer entry points and shell component. Implement hash-based routing behavior in-app (no new dependency) and map route state to main-panel rendering + nav highlighting.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, react-test-renderer, Bun test.

---

### Task 1: Add RED tests for route-driven UI

**Files:**
- Modify: `src/renderer/App.test.tsx`

**Step 1: Write the failing test**
- Replace placeholder assertions with route-aware assertions:
  - empty hash renders chat view marker
  - `#/search` renders search view marker
  - `Knowledge Base` and `Files` appear in sidebar

**Step 2: Run test to verify it fails**
Run: `bun test src/renderer/App.test.tsx`
Expected: FAIL because current placeholder UI does not expose new markers.

**Step 3: Commit**
```bash
git add src/renderer/App.test.tsx
git commit -m "test(renderer): add remio chat-search shell route coverage"
```

### Task 2: Implement hash route state + shell navigation

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/app-shell.tsx`

**Step 1: Write minimal implementation**
- Implement route parsing and navigation in `App.tsx`:
  - Supported routes: `/chat`, `/search`
  - Empty/invalid hash normalizes to `#/chat`
  - Listen to `hashchange` to sync route state
- Refactor `AppShell` to receive:
  - `route`
  - `onNavigate(route)`
- Build left rail and main panels with test ids:
  - `chat-panel`
  - `search-panel`
  - include `Knowledge Base` and `Files`

**Step 2: Run tests to verify it passes**
Run: `bun test src/renderer/App.test.tsx`
Expected: PASS.

**Step 3: Commit**
```bash
git add src/renderer/App.tsx src/renderer/components/app-shell.tsx
git commit -m "feat(renderer): add hash-routed remio-style chat-search shell"
```

### Task 3: Verify full renderer integrity

**Files:**
- Modify (if needed): `src/renderer/index.css`

**Step 1: Run focused suite**
Run: `bun test src/renderer`
Expected: PASS.

**Step 2: Run lint for touched files**
Run: `bun run lint`
Expected: PASS or no new issues in touched files.

**Step 3: Commit**
```bash
git add src/renderer/index.css
git commit -m "style(renderer): polish remio-inspired light shell visuals"
```
