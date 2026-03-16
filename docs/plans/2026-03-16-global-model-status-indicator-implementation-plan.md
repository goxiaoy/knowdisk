# Global Model Status Indicator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a global icon-only model status indicator with hover details, fed by push updates from main process model-service state.

**Architecture:** Use Electrobun RPC between bun main and renderer. Main subscribes to model status store and emits `modelStatusUpdated` messages. Renderer requests initial status and applies subsequent pushes to app state, then renders indicator in shell.

**Tech Stack:** Electrobun RPC, React 18, TypeScript, Tailwind CSS, Bun test.

---

### Task 1: Add failing tests for global indicator rendering

**Files:**
- Modify: `src/renderer/App.test.tsx`

**Step 1: Write the failing test**
- Assert `data-testid="global-status-indicator"` exists on default chat route.
- Assert same indicator exists on `/search` route.

**Step 2: Run test to verify it fails**
Run: `bun test src/renderer/App.test.tsx`
Expected: FAIL because indicator is not yet rendered.

**Step 3: Commit**
```bash
git add src/renderer/App.test.tsx
git commit -m "test(renderer): add global model status indicator coverage"
```

### Task 2: Implement main-to-renderer status push bridge

**Files:**
- Create: `src/shared/model-status.ts`
- Modify: `src/bun/index.ts`

**Step 1: Add shared payload types and fallback status model**
- Define renderer-safe status types and default fallback values.

**Step 2: Add Electrobun RPC in main process**
- Define RPC handlers with `getModelStatus` request.
- Subscribe to model service status store and push `modelStatusUpdated` messages.
- Pass RPC instance to `BrowserWindow`.
- Unsubscribe on close.

**Step 3: Run type/tests for touched area**
Run: `bun test src/bun/app.container.test.ts`
Expected: PASS.

**Step 4: Commit**
```bash
git add src/shared/model-status.ts src/bun/index.ts
git commit -m "feat(bun): push model status updates to renderer via rpc"
```

### Task 3: Implement renderer listener and global indicator UI

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/app-shell.tsx`

**Step 1: Add renderer RPC setup**
- Dynamic-import `electrobun/view` in effect.
- Request initial status and subscribe to `modelStatusUpdated` messages.
- Store status in React state and pass to `AppShell`.

**Step 2: Add global indicator component**
- Render icon-only status button in top-right of main panel.
- Add hover card with overall + per-model rows and percentages.
- Add color/animation state classes and reduced-motion support.

**Step 3: Run renderer test suite**
Run: `bun test src/renderer`
Expected: PASS.

**Step 4: Commit**
```bash
git add src/renderer/App.tsx src/renderer/components/app-shell.tsx
git commit -m "feat(renderer): add global model status indicator with hover details"
```
