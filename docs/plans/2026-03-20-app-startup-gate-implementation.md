# App Startup Gate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a global loading screen until renderer RPC and initial runtime statuses are ready, then reveal the main app shell.

**Architecture:** Keep startup orchestration in `App.tsx` by tracking `appReady` and `startupError`. Reuse the existing initialization effect for RPC bootstrapping, but gate `AppShell` rendering until all initial requests succeed.

**Tech Stack:** React, Electrobun RPC, Bun tests

---

### Task 1: Add failing App tests for startup loading gate

**Files:**
- Modify: `src/renderer/App.test.tsx`

**Step 1: Write the failing test**

Add tests covering:
- app shows a startup loading screen before ready
- app still renders the requested route after startup completes

**Step 2: Run test to verify it fails**

Run: `bun test src/renderer/App.test.tsx`
Expected: FAIL because the app currently renders `AppShell` immediately.

**Step 3: Write minimal implementation**

Add startup gate state and loading UI in `App.tsx`.

**Step 4: Run test to verify it passes**

Run: `bun test src/renderer/App.test.tsx`
Expected: PASS

### Task 2: Add startup error state test

**Files:**
- Modify: `src/renderer/App.test.tsx`
- Modify: `src/renderer/App.tsx`

**Step 1: Write the failing test**

Add a test asserting startup failure shows a dedicated error screen instead of rendering business panels.

**Step 2: Run test to verify it fails**

Run: `bun test src/renderer/App.test.tsx`
Expected: FAIL until startup error UI is added.

**Step 3: Write minimal implementation**

Add startup error state rendering and retry action wiring if needed.

**Step 4: Run test to verify it passes**

Run: `bun test src/renderer/App.test.tsx`
Expected: PASS

### Task 3: Final verification

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

**Step 1: Run focused verification**

Run: `bun test src/renderer/App.test.tsx src/renderer/components/shell/search-panel.test.tsx src/renderer/components/shell/app-shell-layout.test.tsx`
Expected: PASS

**Step 2: Commit**

```bash
git add docs/plans/2026-03-20-app-startup-gate-design.md docs/plans/2026-03-20-app-startup-gate-implementation.md src/renderer/App.tsx src/renderer/App.test.tsx
git commit -m "fix(renderer): gate app shell on startup readiness"
```
