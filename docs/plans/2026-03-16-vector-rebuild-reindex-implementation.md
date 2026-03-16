# Vector Rebuild Reindex Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically trigger a background full reindex when the vector index is rebuilt after corruption, while keeping the UI usable and surfacing rebuild progress in the sidebar.

**Architecture:** Add a one-shot recovery flag to the vector repository, consume it during app runtime startup, and launch an async full-file walk that reuses the existing parser/indexing pipeline. Expose rebuild state through the existing Vector DB status RPC so the renderer can keep polling and render progress.

**Tech Stack:** Bun, React, TypeScript, electrobun RPC, local VFS, parser service, zvec.

---

### Task 1: Recovery state plumbing

**Files:**
- Modify: `packages/indexing/src/vector/vector.repository.types.ts`
- Modify: `packages/indexing/src/vector/vector.repository.test.ts`
- Modify: `packages/indexing/src/vector/vector.repository.ts`

### Task 2: Startup full reindex runtime

**Files:**
- Modify: `src/bun/app.container.ts`
- Modify: `src/bun/app.container.test.ts`

### Task 3: Renderer status surface

**Files:**
- Modify: `src/shared/vector-db-status.ts`
- Modify: `src/bun/index.ts`
- Modify: `src/renderer/components/shell/vector-db-status-indicator.tsx`
- Modify: `src/renderer/App.test.tsx`

### Task 4: Verification

**Files:**
- Verify targeted tests and build
