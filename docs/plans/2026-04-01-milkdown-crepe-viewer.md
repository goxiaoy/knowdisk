# Milkdown Crepe Viewer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current read-only Milkdown viewer with a read-only `@milkdown/crepe`-backed viewer while preserving fallback rendering and tests.

**Architecture:** Keep the current `MarkdownViewer` API unchanged and swap the browser-only renderer from `MilkdownProvider + useEditor` to a lazily loaded `Crepe` instance mounted into a DOM container. Configure Crepe in read-only mode so the preview surface matches the future editor foundation without exposing edit interactions yet.

**Tech Stack:** React, Milkdown Crepe, Bun test, existing renderer CSS

---

### Task 1: Add Crepe dependency and update viewer tests

**Files:**
- Modify: `package.json`
- Modify: `src/renderer/components/markdown-viewer.test.tsx`

**Step 1: Write the failing test**

Update the test mocks to expect `@milkdown/crepe` usage instead of `@milkdown/react` and assert read-only config is passed to Crepe.

**Step 2: Run test to verify it fails**

Run: `bun test src/renderer/components/markdown-viewer.test.tsx`
Expected: FAIL because the component still imports the old Milkdown packages.

**Step 3: Write minimal implementation**

Add `@milkdown/crepe` to `package.json` and adjust the test module mocks to reflect the new constructor/mount lifecycle.

**Step 4: Run test to verify it passes**

Run: `bun test src/renderer/components/markdown-viewer.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add package.json src/renderer/components/markdown-viewer.test.tsx
git commit -m "refactor: prepare markdown viewer for crepe"
```

### Task 2: Replace the viewer implementation with Crepe

**Files:**
- Modify: `src/renderer/components/markdown-viewer.tsx`
- Modify: `src/renderer/index.css`
- Test: `src/renderer/components/markdown-viewer.test.tsx`

**Step 1: Write the failing test**

Add assertions for:
- browser mode mounts a Crepe-backed container
- read-only mode is configured
- loading fallback still appears before mount

**Step 2: Run test to verify it fails**

Run: `bun test src/renderer/components/markdown-viewer.test.tsx`
Expected: FAIL because the old viewer does not create a Crepe instance.

**Step 3: Write minimal implementation**

Refactor `MarkdownViewer` to lazily import `@milkdown/crepe`, mount a read-only editor into a ref-backed container, destroy the instance on cleanup, and keep the SSR/plain-text fallback. Add minimal `.milkdown`/Crepe container styling if needed so the preview still renders cleanly.

**Step 4: Run test to verify it passes**

Run: `bun test src/renderer/components/markdown-viewer.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/components/markdown-viewer.tsx src/renderer/components/markdown-viewer.test.tsx src/renderer/index.css
git commit -m "refactor: switch markdown viewer to crepe"
```

### Task 3: Verify no renderer regressions

**Files:**
- Test: `src/renderer/components/markdown-viewer.test.tsx`

**Step 1: Run targeted verification**

Run: `bun test src/renderer/components/markdown-viewer.test.tsx`
Expected: PASS

**Step 2: Run adjacent UI verification**

Run: `bun test src/renderer/components/shell/status-indicator.test.tsx`
Expected: PASS, confirming the renderer change did not break nearby UI test setup.

**Step 3: Review git diff**

Run: `git diff -- src/renderer/components/markdown-viewer.tsx src/renderer/components/markdown-viewer.test.tsx src/renderer/index.css package.json`
Expected: Only Crepe migration changes appear.

**Step 4: Commit**

```bash
git add docs/plans/2026-04-01-milkdown-crepe-viewer.md
git commit -m "docs: add crepe viewer plan"
```
