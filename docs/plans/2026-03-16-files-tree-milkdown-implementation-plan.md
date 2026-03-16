# Files Route Tree + Milkdown Preview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a `#/files` page with VFS tree navigation, `Add` directory mount via `vfs.mount`, and parser markdown preview rendered by Milkdown.

**Architecture:** Extend existing Electrobun RPC channel in main/renderer. Main provides filesystem and parser-backed requests. Renderer adds a Files panel with lazy tree loading and markdown preview.

**Tech Stack:** React 18, Electrobun RPC, @knowdisk/vfs, @knowdisk/parser, Milkdown, Bun test.

---

### Task 1: RED tests for files route rendering

**Files:**
- Modify: `src/renderer/App.test.tsx`

**Step 1: Write failing test**
- Add test: `App initialRoute="/files"` renders `data-testid="files-panel"`.

**Step 2: Verify fail**
Run: `bun test src/renderer/App.test.tsx`
Expected: FAIL.

### Task 2: Main-process RPC for files and markdown

**Files:**
- Modify: `src/bun/index.ts`
- Create: `src/shared/files.ts`

**Step 1: Add shared types**
- Define tree node and markdown response payloads.

**Step 2: Extend RPC requests**
- `pickAndMountLocalDirectory`
- `listFilesNodes`
- `getFileMarkdown`
- Start VFS runtime at boot and dispose on close.

**Step 3: Verify**
Run: `bun test src/bun/app.container.test.ts`
Expected: PASS.

### Task 3: Renderer files page + Milkdown preview

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/app-shell.tsx`
- Create: `src/renderer/components/files-panel.tsx`
- Create: `src/renderer/components/markdown-viewer.tsx`
- Modify: `src/renderer/index.css`
- Modify: `package.json` (Milkdown deps)

**Step 1: Add route and RPC wrappers in App**
- Add `/files` route handling.
- Expose async handlers to Files panel.

**Step 2: Build Files panel**
- Left tree with expand/collapse and Add button.
- Right markdown preview with loading/error placeholders.

**Step 3: Integrate Milkdown read-only viewer**
- Render parser markdown in a read-only editor surface.

**Step 4: Verify**
Run: `bun test src/renderer/App.test.tsx`
Expected: PASS.
