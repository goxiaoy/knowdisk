# Parser Example Hook Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a CLI-style parser example that mounts a local VFS directory, listens for `afterUpdateContent` events, parses updated file nodes, and prints emitted `ParseChunk` records.

**Architecture:** Keep the example isolated under `packages/parser/example` and reuse the existing VFS runtime primitives directly instead of modifying the VFS server example. The example should create a local mount, register a VFS node hook, drive parsing through `ParserService.parseNode`, and print compact terminal output for both successful and fallback parse results.

**Tech Stack:** Bun workspaces, TypeScript, Bun test, `@knowdisk/vfs`, `@knowdisk/parser`

---

### Task 1: Add parser example script wiring

**Files:**
- Modify: `packages/parser/package.json`
- Create: `packages/parser/example/app.ts`
- Test: `packages/parser/example/app.test.ts`

**Step 1: Write the failing test**

Add a test in `packages/parser/example/app.test.ts` that imports the parser example entry and asserts the example app factory or runner is exported.

**Step 2: Run test to verify it fails**

Run: `bun test packages/parser/example/app.test.ts`
Expected: FAIL with missing module or export error.

**Step 3: Write minimal implementation**

Create `packages/parser/example/app.ts` with a minimal exported runner or app factory and add `"example": "bun example/app.ts"` to `packages/parser/package.json`.

**Step 4: Run test to verify it passes**

Run: `bun test packages/parser/example/app.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/parser/package.json packages/parser/example/app.ts packages/parser/example/app.test.ts
git commit -m "feat: bootstrap parser example"
```

### Task 2: Add parser example logger and runtime bootstrap

**Files:**
- Create: `packages/parser/example/logger.ts`
- Modify: `packages/parser/example/app.ts`
- Test: `packages/parser/example/app.test.ts`

**Step 1: Write the failing test**

Add tests that assert the example can create its runtime directories and logger-backed output stream without starting VFS syncing yet.

**Step 2: Run test to verify it fails**

Run: `bun test packages/parser/example/app.test.ts`
Expected: FAIL because runtime bootstrap helpers do not exist.

**Step 3: Write minimal implementation**

Add:
- example logger
- runtime directory creation for VFS DB, content root, and parser cache
- a returned stop/close handle

**Step 4: Run test to verify it passes**

Run: `bun test packages/parser/example/app.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/parser/example/logger.ts packages/parser/example/app.ts packages/parser/example/app.test.ts
git commit -m "feat: add parser example runtime bootstrap"
```

### Task 3: Mount local example data through VFS

**Files:**
- Modify: `packages/parser/example/app.ts`
- Create: `packages/parser/example/data/hello.md`
- Create: `packages/parser/example/data/info.json`
- Create: `packages/parser/example/data/image.png`
- Create: `packages/parser/example/data/paper.pdf`
- Test: `packages/parser/example/app.test.ts`

**Step 1: Write the failing test**

Add tests that:
- mount the local provider against example data
- expose the mounted local mount id
- start the VFS runtime without throwing

**Step 2: Run test to verify it fails**

Run: `bun test packages/parser/example/app.test.ts`
Expected: FAIL because local mount bootstrapping is incomplete.

**Step 3: Write minimal implementation**

Implement local mount creation with `providerType: "local"` pointing to `packages/parser/example/data`.

Add sample files:
- real markdown and json text fixtures
- placeholder binary fixtures for image/pdf sufficient for parse-attempt demonstration

**Step 4: Run test to verify it passes**

Run: `bun test packages/parser/example/app.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/parser/example/app.ts packages/parser/example/app.test.ts packages/parser/example/data/*
git commit -m "feat: mount parser example data through vfs"
```

### Task 4: Register afterUpdateContent hook and print parse output

**Files:**
- Modify: `packages/parser/example/app.ts`
- Test: `packages/parser/example/app.test.ts`

**Step 1: Write the failing test**

Add tests that:
- capture example output into a memory stream
- verify `afterUpdateContent` parses file nodes
- verify output includes `[PARSE]` and `[CHUNK]` lines

**Step 2: Run test to verify it fails**

Run: `bun test packages/parser/example/app.test.ts`
Expected: FAIL because no hook-driven parser output exists yet.

**Step 3: Write minimal implementation**

In the example:
- create `ParserService`
- register `afterUpdateContent`
- call `parseNode({ nodeId })`
- print compact parse/chunk lines to the logger output stream

**Step 4: Run test to verify it passes**

Run: `bun test packages/parser/example/app.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/parser/example/app.ts packages/parser/example/app.test.ts
git commit -m "feat: parse vfs content hook events in parser example"
```

### Task 5: Cover success and fallback parse output

**Files:**
- Modify: `packages/parser/example/app.test.ts`
- Modify: `packages/parser/example/app.ts`

**Step 1: Write the failing test**

Add tests that:
- assert markdown/json produce at least one `status=ok` chunk output
- assert image/pdf produce parse output attempts with `status=error` or `status=skipped`

Do not require pdf/image success.

**Step 2: Run test to verify it fails**

Run: `bun test packages/parser/example/app.test.ts`
Expected: FAIL because output formatting or coverage is incomplete.

**Step 3: Write minimal implementation**

Refine output formatting to include:
- `status`
- `chunkIndex`
- `heading`
- `tokenEstimate`
- `error.code`
- `error.message`

**Step 4: Run test to verify it passes**

Run: `bun test packages/parser/example/app.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/parser/example/app.ts packages/parser/example/app.test.ts
git commit -m "feat: report parser example chunk outcomes"
```

### Task 6: Final verification and docs sync

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/plans/2026-03-10-parser-example-hook-design.md`
- Modify: `docs/plans/2026-03-10-parser-example-hook-implementation-plan.md`

**Step 1: Update docs**

Add a short note describing how to run the parser example:

```bash
bun run --cwd packages/parser example
```

**Step 2: Run targeted verification**

Run: `bun test packages/parser/example/app.test.ts`
Expected: PASS.

**Step 3: Run package verification**

Run: `bun test packages/parser`
Expected: PASS, or document any unrelated failures before proceeding.

**Step 4: Run example manually**

Run: `bun run --cwd packages/parser example`
Expected: terminal output containing `[PARSE]` and `[CHUNK]` lines for sample files.

**Step 5: Commit**

```bash
git add README.md README.zh-CN.md docs/plans/2026-03-10-parser-example-hook-design.md docs/plans/2026-03-10-parser-example-hook-implementation-plan.md packages/parser/example/app.ts packages/parser/example/app.test.ts packages/parser/example/logger.ts packages/parser/example/data/*
git commit -m "docs: add parser example usage"
```
