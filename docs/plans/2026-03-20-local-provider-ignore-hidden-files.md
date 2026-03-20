# Local Provider Ignore Hidden Files Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the local VFS provider ignore Unix hidden files and directories in listings and watch events.

**Architecture:** Keep the behavior inside the local provider so the provider boundary stays consistent for both direct listing and filesystem watch delivery. Add a small shared hidden-path predicate and reuse it in `listChildren` and `watch`, then update provider tests and the local sync integration helper to reflect the same rule.

**Tech Stack:** TypeScript, Bun test, chokidar, Node fs/promises

---

### Task 1: Add failing provider tests for hidden entries

**Files:**
- Modify: `packages/vfs/src/provider/local/local.provider.test.ts`

**Step 1: Write the failing test**

Add tests covering:
- `listChildren()` excludes `.gitignore`-style files and hidden directories.
- `watch()` does not emit events for hidden files or files created inside hidden directories.

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/provider/local/local.provider.test.ts`
Expected: FAIL because hidden entries are currently returned and watched.

**Step 3: Write minimal implementation**

Implement hidden path filtering in the local provider.

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/provider/local/local.provider.test.ts`
Expected: PASS

### Task 2: Keep local sync integration expectations aligned

**Files:**
- Modify: `packages/vfs/src/vfs.syncer.integration.test.ts`

**Step 1: Write the failing test adjustment**

Update the local filesystem helper used for assertions so it skips hidden files and hidden directories, matching provider behavior.

**Step 2: Run targeted integration test if needed**

Run: `bun test packages/vfs/src/vfs.syncer.integration.test.ts -t "local provider fullSync and watch stay aligned with filesystem changes"`
Expected: PASS after helper update, or FAIL first if hidden entries are introduced in fixture expansion.

**Step 3: Commit**

```bash
git add docs/plans/2026-03-20-local-provider-ignore-hidden-files.md packages/vfs/src/provider/local/local.provider.test.ts packages/vfs/src/provider/local/index.ts packages/vfs/src/vfs.syncer.integration.test.ts
git commit -m "fix(vfs): ignore hidden files in local provider"
```
