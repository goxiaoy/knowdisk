# Parser Package Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a new `packages/parser` workspace package that reads file bytes from `@knowdisk/vfs`, converts supported files to markdown, sections that markdown, splits it into parse chunks, and caches parse artifacts under a local `basePath`.

**Architecture:** Build the package as a self-contained parser pipeline with explicit stages for VFS read, markdown conversion, remark sectioning, and LangChain chunk splitting. Keep the package independent from the current indexing stack so it can be validated in isolation first and integrated later.

**Tech Stack:** Bun workspaces, TypeScript, Bun test, `@knowdisk/vfs`, `markitdown-ts`, `remark`, LangChain text splitter

---

### Task 1: Bootstrap the workspace package contract

**Files:**
- Modify: `package.json`
- Create: `packages/parser/package.json`
- Create: `packages/parser/src/index.ts`
- Test: `packages/parser/src/parser.package.test.ts`

**Step 1: Write the failing test**

Add a test in `packages/parser/src/parser.package.test.ts` that imports `createParserService` and the exported parser types from `packages/parser/src/index.ts`.

**Step 2: Run test to verify it fails**

Run: `bun test packages/parser/src/parser.package.test.ts`
Expected: FAIL with module resolution or missing export errors.

**Step 3: Write minimal implementation**

Add workspace dependency wiring in `package.json`, create `packages/parser/package.json`, and create `packages/parser/src/index.ts` with placeholder exports for the package API.

**Step 4: Run test to verify it passes**

Run: `bun test packages/parser/src/parser.package.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add package.json packages/parser/package.json packages/parser/src/index.ts packages/parser/src/parser.package.test.ts
git commit -m "feat: bootstrap parser workspace package"
```

### Task 2: Define parser types and constructor validation

**Files:**
- Create: `packages/parser/src/parser.types.ts`
- Create: `packages/parser/src/parser.service.ts`
- Modify: `packages/parser/src/index.ts`
- Test: `packages/parser/src/parser.service.test.ts`

**Step 1: Write the failing test**

Add tests that:
- construct the service with `vfs`, `basePath`, and `logger`
- reject empty `basePath`
- expose `parseNode`, `materializeNode`, and `getCachePaths`

**Step 2: Run test to verify it fails**

Run: `bun test packages/parser/src/parser.service.test.ts`
Expected: FAIL because constructor and types do not exist yet.

**Step 3: Write minimal implementation**

Add:
- `ParseDocument`
- `ParseSection`
- `ParseChunk`
- `ParseManifest`
- `ParserService`
- `createParserService`

Implement only constructor validation and `getCachePaths` path generation.

**Step 4: Run test to verify it passes**

Run: `bun test packages/parser/src/parser.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/parser/src/index.ts packages/parser/src/parser.types.ts packages/parser/src/parser.service.ts packages/parser/src/parser.service.test.ts
git commit -m "feat: add parser service contract"
```

### Task 3: Add VFS read and node validation

**Files:**
- Modify: `packages/parser/src/parser.service.ts`
- Test: `packages/parser/src/parser.service.test.ts`
- Test: `packages/parser/src/parser.read.test.ts`

**Step 1: Write the failing test**

Add tests that:
- load node metadata by `nodeId`
- reject missing nodes
- reject non-file nodes
- read bytes from `vfs.createReadStream({ id })`
- convert the stream to a `Buffer`

Use a fake VFS implementation inside the tests.

**Step 2: Run test to verify it fails**

Run: `bun test packages/parser/src/parser.read.test.ts`
Expected: FAIL because read helpers are not implemented.

**Step 3: Write minimal implementation**

Implement internal helpers for:
- `getNodeOrThrow`
- `readNodeBuffer`
- stream-to-buffer conversion

Keep errors internal for now; the outer parse flow can translate them later.

**Step 4: Run test to verify it passes**

Run: `bun test packages/parser/src/parser.read.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/parser/src/parser.service.ts packages/parser/src/parser.service.test.ts packages/parser/src/parser.read.test.ts
git commit -m "feat: add parser vfs read stage"
```

### Task 4: Add markdown cache layout and manifest handling

**Files:**
- Modify: `packages/parser/src/parser.service.ts`
- Create: `packages/parser/src/parser.cache.ts`
- Test: `packages/parser/src/parser.cache.test.ts`

**Step 1: Write the failing test**

Add tests that:
- create `<basePath>/<mountId>/<nodeId>/`
- write `document.md` and `manifest.json`
- reuse cached markdown when `providerVersion` matches
- ignore cache when `providerVersion` changes
- ignore cache when `providerVersion` is `null`

Use a temporary directory in each test.

**Step 2: Run test to verify it fails**

Run: `bun test packages/parser/src/parser.cache.test.ts`
Expected: FAIL because cache read/write helpers do not exist.

**Step 3: Write minimal implementation**

Implement:
- cache directory creation
- manifest serialization
- markdown cache read/write
- cache reuse check based on `providerVersion`

**Step 4: Run test to verify it passes**

Run: `bun test packages/parser/src/parser.cache.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/parser/src/parser.service.ts packages/parser/src/parser.cache.ts packages/parser/src/parser.cache.test.ts
git commit -m "feat: add parser markdown cache"
```

### Task 5: Add markdown conversion abstraction with `markitdown-ts`

**Files:**
- Create: `packages/parser/src/converter.ts`
- Modify: `packages/parser/src/parser.service.ts`
- Modify: `packages/parser/src/parser.types.ts`
- Test: `packages/parser/src/converter.test.ts`

**Step 1: Write the failing test**

Add tests that:
- call the converter with a `Buffer`
- capture returned markdown and title
- allow dependency injection for converter stubs
- map conversion failures into parser error results at the service boundary

Stub the converter in tests; do not depend on third-party parsing behavior for unit coverage.

**Step 2: Run test to verify it fails**

Run: `bun test packages/parser/src/converter.test.ts`
Expected: FAIL because converter abstraction is missing.

**Step 3: Write minimal implementation**

Add a converter interface and a default converter wrapper around `markitdown-ts`.

Update the service so `materializeNode` performs:
- cache lookup
- markdown conversion on miss
- cache write after conversion

**Step 4: Run test to verify it passes**

Run: `bun test packages/parser/src/converter.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/parser/src/converter.ts packages/parser/src/parser.service.ts packages/parser/src/parser.types.ts packages/parser/src/converter.test.ts
git commit -m "feat: add markdown conversion stage"
```

### Task 6: Add remark-based section splitting

**Files:**
- Create: `packages/parser/src/section-splitter.ts`
- Modify: `packages/parser/src/parser.service.ts`
- Test: `packages/parser/src/section-splitter.test.ts`

**Step 1: Write the failing test**

Add tests that:
- create a synthetic preamble section for content before the first heading
- create sections for headings
- preserve heading depth
- build `sectionPath` from nested headings
- preserve section markdown and text

Use compact markdown fixtures directly in the test file.

**Step 2: Run test to verify it fails**

Run: `bun test packages/parser/src/section-splitter.test.ts`
Expected: FAIL because section splitting does not exist.

**Step 3: Write minimal implementation**

Implement a remark-driven section splitter that walks the markdown AST and emits `ParseSection[]`.

**Step 4: Run test to verify it passes**

Run: `bun test packages/parser/src/section-splitter.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/parser/src/section-splitter.ts packages/parser/src/parser.service.ts packages/parser/src/section-splitter.test.ts
git commit -m "feat: add parser section splitting"
```

### Task 7: Add LangChain text splitting and final chunk emission

**Files:**
- Create: `packages/parser/src/text-splitter.ts`
- Modify: `packages/parser/src/parser.service.ts`
- Test: `packages/parser/src/text-splitter.test.ts`
- Test: `packages/parser/src/parser.parse-node.test.ts`

**Step 1: Write the failing test**

Add tests that:
- split large section text into multiple chunks
- preserve section metadata on every chunk
- skip whitespace-only chunks
- compute `chunkIndex`, `charStart`, `charEnd`, and `tokenEstimate`
- expose `parseNode()` as `AsyncIterable<ParseChunk>`

Use an injected splitter stub for precise assertions.

**Step 2: Run test to verify it fails**

Run: `bun test packages/parser/src/text-splitter.test.ts packages/parser/src/parser.parse-node.test.ts`
Expected: FAIL because final chunk emission is not implemented.

**Step 3: Write minimal implementation**

Implement:
- splitter abstraction
- section-to-chunk transformation
- metadata propagation to `ParseChunk`
- async generator for `parseNode()`

**Step 4: Run test to verify it passes**

Run: `bun test packages/parser/src/text-splitter.test.ts packages/parser/src/parser.parse-node.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/parser/src/text-splitter.ts packages/parser/src/parser.service.ts packages/parser/src/text-splitter.test.ts packages/parser/src/parser.parse-node.test.ts
git commit -m "feat: emit parser chunks from markdown sections"
```

### Task 8: Add skipped and error chunk behavior with logging

**Files:**
- Modify: `packages/parser/src/parser.service.ts`
- Modify: `packages/parser/src/parser.types.ts`
- Test: `packages/parser/src/parser.error.test.ts`

**Step 1: Write the failing test**

Add tests that:
- return one skipped chunk for empty markdown
- return one skipped chunk for unsupported content
- return one error chunk when conversion throws
- write `error.json` on error
- call `logger.error(...)` for error cases

Use a logger stub that records log calls.

**Step 2: Run test to verify it fails**

Run: `bun test packages/parser/src/parser.error.test.ts`
Expected: FAIL because error chunk fallback does not exist.

**Step 3: Write minimal implementation**

Implement service-level error translation so parse failures produce:
- `status: "skipped"` or `status: "error"`
- empty `text`
- populated source metadata
- structured `error` payload

Persist `error.json` for conversion and AST failures.

**Step 4: Run test to verify it passes**

Run: `bun test packages/parser/src/parser.error.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/parser/src/parser.service.ts packages/parser/src/parser.types.ts packages/parser/src/parser.error.test.ts
git commit -m "feat: add parser error chunk fallback"
```

### Task 9: Verify package exports and full parser test suite

**Files:**
- Modify: `packages/parser/package.json`
- Modify: `packages/parser/src/index.ts`
- Test: `packages/parser/src/*.test.ts`

**Step 1: Write the failing test**

If missing, add one package-level test that imports the package root and exercises one end-to-end fake-VFS parse flow.

**Step 2: Run test to verify it fails**

Run: `bun test packages/parser/src`
Expected: FAIL if any export or package wiring is incomplete.

**Step 3: Write minimal implementation**

Fix exports, package metadata, or dependency declarations needed for package-root usage.

**Step 4: Run test to verify it passes**

Run: `bun test packages/parser/src`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/parser/package.json packages/parser/src/index.ts packages/parser/src/*.test.ts
git commit -m "feat: finalize parser package exports"
```

### Task 10: Final verification and docs sync

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/plans/2026-03-10-parser-package-design.md`
- Modify: `docs/plans/2026-03-10-parser-package-implementation-plan.md`

**Step 1: Update docs**

Add a short note in the repo docs that `packages/parser` is the VFS-backed parsing package and stores parse cache under a local base path.

**Step 2: Run targeted verification**

Run: `bun test packages/parser/src`
Expected: PASS.

**Step 3: Run broader verification**

Run: `bun test`
Expected: PASS, or document unrelated pre-existing failures before proceeding.

**Step 4: Review docs for drift**

Confirm the design doc still matches the implemented package boundary. If implementation changed any approved design detail, update the design doc before closing.

**Step 5: Commit**

```bash
git add README.md README.zh-CN.md docs/plans/2026-03-10-parser-package-design.md docs/plans/2026-03-10-parser-package-implementation-plan.md
git commit -m "docs: document parser package"
```
