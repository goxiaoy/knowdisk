# Split Directory Pick And Mount Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split directory selection and mount creation into two RPC steps so user input is completed before mount logic runs.

**Architecture:** Replace the combined `pickAndMountLocalDirectory` RPC with `pickLocalDirectory` and `mountLocalDirectory`. The renderer calls them sequentially: pick first, then mount only when a directory is selected.

**Tech Stack:** Electrobun RPC, Bun main process, React renderer, existing files panel flow.

---

### Task 1: Update shared RPC contracts

**Files:**
- Modify: `src/shared/files.ts`
- Modify: `src/renderer/components/files/types.ts`

### Task 2: Split Bun RPC handlers

**Files:**
- Modify: `src/bun/index.ts`
- Test: add/adjust focused Bun tests if needed

### Task 3: Update renderer flow

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/files-panel.tsx`
- Test: `src/renderer/App.test.tsx`

### Task 4: Verify

**Files:**
- Test: focused renderer/Bun tests
- Build: repository build
