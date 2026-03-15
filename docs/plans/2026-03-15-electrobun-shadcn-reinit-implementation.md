# Electrobun Shadcn Reinitialization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current host app under `src/` with a fresh Electrobun + shadcn/ui shell while leaving `packages/*` untouched.

**Architecture:** Rebuild the app host as a minimal Electrobun main process plus a React renderer rooted at `src/renderer`. Remove the old `src/core` and `src/mainview` application code, then wire a small shadcn/ui shell that compiles cleanly with the existing workspace.

**Tech Stack:** Bun workspaces, Electrobun, React, Vite, Tailwind CSS, shadcn/ui, TypeScript, ESLint

---

### Task 1: Create isolated worktree and verify baseline

**Files:**
- Modify: `.gitignore` only if `.worktrees/` is not ignored
- Test: baseline repository status and package test suite

**Step 1: Verify `.worktrees/` is available and ignored**

Run: `ls -d .worktrees && git check-ignore -q .worktrees`
Expected: `.worktrees` exists and is ignored

**Step 2: Create the worktree**

Run: `git worktree add .worktrees/electrobun-reinit -b feat/electrobun-reinit`
Expected: new worktree created from current `main`

**Step 3: Install dependencies in the worktree**

Run: `bun install`
Expected: workspace dependencies resolved without error

**Step 4: Verify package baseline**

Run: `bun test packages/core/src packages/model/src packages/indexing/src packages/parser/src packages/vfs/src`
Expected: PASS before any host-app changes

**Step 5: Commit only if `.gitignore` required a fix**

```bash
git add .gitignore
git commit -m "chore: ignore project worktrees"
```

### Task 2: Remove the legacy host app and tests

**Files:**
- Delete: `src/core/**`
- Delete: `src/mainview/**`
- Delete: `src/bun/**`
- Delete: `src/types/**`
- Delete: host-app tests under `src/**`

**Step 1: Write a failing expectation for the new renderer layout**

Create: `src/renderer/App.test.tsx`

```tsx
import renderer from "react-test-renderer";
import { App } from "./App";

it("renders the shell heading", () => {
  const tree = renderer.create(<App />).toJSON();
  expect(tree).toBeTruthy();
});
```

**Step 2: Run the test to verify the old structure does not satisfy it**

Run: `bun test src/renderer/App.test.tsx`
Expected: FAIL because the new file structure does not exist yet

**Step 3: Remove legacy host directories**

Run: remove the old `src/` app directories and obsolete tests

**Step 4: Re-run the new renderer test**

Run: `bun test src/renderer/App.test.tsx`
Expected: still FAIL until the new shell exists

**Step 5: Commit the removal**

```bash
git add src
git commit -m "refactor(app): remove legacy host implementation"
```

### Task 3: Rebuild the Electrobun host bootstrap

**Files:**
- Create: `src/bun/index.ts`
- Create: `src/types/electrobun.d.ts`
- Modify: `electrobun.config.ts` if entry paths need alignment

**Step 1: Write the failing host bootstrap test**

Create: `src/bun/index.test.ts`

```ts
import { createWindowOptions } from "./index";

it("returns renderer-backed window options", () => {
  expect(createWindowOptions().url).toContain("index.html");
});
```

**Step 2: Run the test to verify it fails**

Run: `bun test src/bun/index.test.ts`
Expected: FAIL because the bootstrap file does not exist

**Step 3: Implement the minimal Electrobun bootstrap**

Create the main-process entry and export a testable `createWindowOptions()`

**Step 4: Run the test to verify it passes**

Run: `bun test src/bun/index.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bun src/types electrobun.config.ts
git commit -m "feat(app): add electrobun host bootstrap"
```

### Task 4: Rebuild the React renderer shell with shadcn/ui

**Files:**
- Create: `components.json`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/App.test.tsx`
- Create: `src/renderer/index.css`
- Create: `src/renderer/lib/utils.ts`
- Create: `src/renderer/components/app-shell.tsx`
- Create: `src/renderer/components/ui/*.tsx`
- Modify: `tailwind.config.js`
- Modify: `vite.config.ts`
- Modify: `tsconfig.json` if path aliases are needed

**Step 1: Write the failing renderer test for shell content**

```tsx
import renderer from "react-test-renderer";
import { App } from "./App";

it("shows the application title and placeholder cards", () => {
  const tree = renderer.create(<App />).root;
  expect(tree.findByProps({ "data-testid": "app-title" }).children).toContain("KnowDisk");
});
```

**Step 2: Run the test to verify it fails**

Run: `bun test src/renderer/App.test.tsx`
Expected: FAIL because the renderer shell is not implemented

**Step 3: Initialize shadcn/ui structure and implement the renderer shell**

Add the minimum shadcn/ui setup and build a small shell around reusable primitives

**Step 4: Run the renderer test**

Run: `bun test src/renderer/App.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add components.json src/renderer tailwind.config.js vite.config.ts tsconfig.json
git commit -m "feat(app): add shadcn renderer shell"
```

### Task 5: Align scripts, lint, and build

**Files:**
- Modify: `package.json`
- Modify: any root config required by the new shell

**Step 1: Write the failing verification expectation**

Run: `bun run build`
Expected: FAIL until all paths and configs align with the new shell

**Step 2: Adjust scripts and config**

Update root scripts and build configuration only as needed for the new `src/bun` and `src/renderer` layout

**Step 3: Run lint**

Run: `bun run lint`
Expected: PASS

**Step 4: Run build**

Run: `bun run build`
Expected: PASS

**Step 5: Commit**

```bash
git add package.json electrobun.config.ts vite.config.ts tsconfig.json bun.lock
git commit -m "chore(app): align build and lint for reinitialized shell"
```

### Task 6: Final verification and cleanup

**Files:**
- Review all modified files

**Step 1: Run package tests**

Run: `bun test packages/core/src packages/model/src packages/indexing/src packages/parser/src packages/vfs/src`
Expected: PASS

**Step 2: Run renderer and host tests**

Run: `bun test src/renderer/App.test.tsx src/bun/index.test.ts`
Expected: PASS

**Step 3: Run full verification**

Run: `bun run lint && bun run build`
Expected: PASS

**Step 4: Inspect git status**

Run: `git status --short`
Expected: only intended files changed

**Step 5: Commit**

```bash
git add .
git commit -m "feat(app): reinitialize electrobun host shell"
```
