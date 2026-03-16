# Vector DB Status Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a compact Vector DB status icon in the sidebar footer that polls and displays the current chunk count.

**Architecture:** Add a read-only Bun RPC that returns the current vector chunk count from the vector repository. Poll that RPC from the renderer and render a small footer indicator with a tooltip for the full count.

**Tech Stack:** Bun RPC, React renderer, Lucide icons, existing shadcn/ui sidebar patterns, zvec-backed vector repository.

---

### Task 1: Expose vector chunk count from the repository

**Files:**
- Modify: `packages/indexing/src/vector/vector.repository.types.ts`
- Modify: `packages/indexing/src/vector/vector.repository.ts`
- Test: `packages/indexing/src/vector/vector.repository.test.ts`

### Task 2: Wire a Bun RPC for Vector DB status

**Files:**
- Modify: `src/bun/app.container.ts`
- Modify: `src/bun/index.ts`
- Modify: `src/renderer/App.tsx`

### Task 3: Render a polled sidebar indicator

**Files:**
- Create: `src/shared/vector-db-status.ts`
- Create: `src/renderer/components/shell/vector-db-status-indicator.tsx`
- Modify: `src/renderer/components/shell/app-sidebar.tsx`
- Test: renderer tests if needed for polling/rendering behavior

### Task 4: Verify

**Files:**
- Test: `packages/indexing/src/vector/vector.repository.test.ts`
- Test: targeted renderer/Bun tests as needed
- Build: repository build
