# Indexing Package Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a reusable `packages/indexing` workspace package that indexes `ParseChunk` streams into SQLite FTS and zvec, and exposes hybrid search with pluggable embedding and reranker registries.

**Architecture:** The package owns its own types, registries, repositories, and service layer. `index()` rewrites all index data for one `nodeId`, `delete()` removes one node from both stores, and `search()` returns final hybrid results plus debug outputs for FTS, vector, and reranked stages.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, `@zvec/zvec`, `tsyringe`, workspace packages `@knowdisk/parser` and `@knowdisk/vfs`.

---

### Task 1: Scaffold the Package

**Files:**
- Create: `packages/indexing/package.json`
- Create: `packages/indexing/src/index.ts`
- Create: `packages/indexing/src/indexing.types.ts`
- Test: `packages/indexing/src/indexing.package.test.ts`

**Step 1: Write the failing test**

Create a package-root test that imports `createIndexingService`, `createEmbeddingRegistry`, and `createRerankerRegistry` from `@knowdisk/indexing` and asserts they are functions.

**Step 2: Run test to verify it fails**

Run: `bun test packages/indexing/src/indexing.package.test.ts`
Expected: FAIL because package files and exports do not exist.

**Step 3: Write minimal implementation**

- Add `package.json` with workspace-style config and dependencies on `@knowdisk/parser`, `@knowdisk/vfs`, and `pino`.
- Add `src/index.ts` exporting placeholder factory functions.
- Add `src/indexing.types.ts` with initial public type shells.

**Step 4: Run test to verify it passes**

Run: `bun test packages/indexing/src/indexing.package.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing
git commit -m "feat(indexing): scaffold package surface"
```

### Task 2: Define Public Contracts

**Files:**
- Modify: `packages/indexing/src/indexing.types.ts`
- Test: `packages/indexing/src/indexing.types.test.ts`

**Step 1: Write the failing test**

Add a test covering:
- `SearchResultSet` shape
- `SearchHit.scores` shape
- `IndexingService` methods `index`, `delete`, `search`
- provider contract compatibility with stub embedding/reranker implementations

**Step 2: Run test to verify it fails**

Run: `bun test packages/indexing/src/indexing.types.test.ts`
Expected: FAIL due to missing or incomplete types.

**Step 3: Write minimal implementation**

Add exact public types for:
- `IndexingService`
- `CreateIndexingServiceInput`
- `EmbeddingProvider`
- `RerankerProvider`
- `EmbeddingRegistry`
- `RerankerRegistry`
- `SearchHit`
- `SearchResultSet`

Use `VfsNode` and `ParseChunk` from workspace packages in the public contract.

**Step 4: Run test to verify it passes**

Run: `bun test packages/indexing/src/indexing.types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src/indexing.types.ts packages/indexing/src/indexing.types.test.ts
git commit -m "feat(indexing): define service and provider contracts"
```

### Task 3: Build Embedding Registry

**Files:**
- Create: `packages/indexing/src/embedding.registry.ts`
- Test: `packages/indexing/src/embedding.registry.test.ts`

**Step 1: Write the failing test**

Cover:
- register/get/listTypes
- duplicate type overwrite behavior
- unknown type throws clear error
- factory receives container and options

**Step 2: Run test to verify it fails**

Run: `bun test packages/indexing/src/embedding.registry.test.ts`
Expected: FAIL because registry is missing.

**Step 3: Write minimal implementation**

Implement registry API mirroring `VfsProviderRegistry` style, but keyed only by provider type and creation options.

**Step 4: Run test to verify it passes**

Run: `bun test packages/indexing/src/embedding.registry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src/embedding.registry.ts packages/indexing/src/embedding.registry.test.ts
git commit -m "feat(indexing): add embedding registry"
```

### Task 4: Build Reranker Registry

**Files:**
- Create: `packages/indexing/src/reranker.registry.ts`
- Test: `packages/indexing/src/reranker.registry.test.ts`

**Step 1: Write the failing test**

Cover:
- register/get/listTypes
- unknown type throws
- factory returns reranker implementation

**Step 2: Run test to verify it fails**

Run: `bun test packages/indexing/src/reranker.registry.test.ts`
Expected: FAIL because registry is missing.

**Step 3: Write minimal implementation**

Implement reranker registry with the same behavior and error style as embedding registry.

**Step 4: Run test to verify it passes**

Run: `bun test packages/indexing/src/reranker.registry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src/reranker.registry.ts packages/indexing/src/reranker.registry.test.ts
git commit -m "feat(indexing): add reranker registry"
```

### Task 5: Build FTS Repository

**Files:**
- Create: `packages/indexing/src/fts.repository.ts`
- Create: `packages/indexing/src/fts.repository.types.ts`
- Test: `packages/indexing/src/fts.repository.test.ts`

**Step 1: Write the failing test**

Cover:
- schema bootstraps in SQLite
- upsert rows for one node
- delete rows by `nodeId`
- full-text query search
- title-only query search on `title/name/sourceRef`

Use temp SQLite files, not in-memory shared global state.

**Step 2: Run test to verify it fails**

Run: `bun test packages/indexing/src/fts.repository.test.ts`
Expected: FAIL because repository is missing.

**Step 3: Write minimal implementation**

Implement:
- schema creation
- `replaceNodeChunks(rows)`
- `deleteByNodeId(nodeId)`
- `search(query, opts)`

Store all non-vector chunk metadata needed to reconstruct `SearchHit`.

**Step 4: Run test to verify it passes**

Run: `bun test packages/indexing/src/fts.repository.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src/fts.repository.* 
git commit -m "feat(indexing): add sqlite fts repository"
```

### Task 6: Build Vector Repository Adapter

**Files:**
- Create: `packages/indexing/src/vector.repository.ts`
- Create: `packages/indexing/src/vector.repository.types.ts`
- Test: `packages/indexing/src/vector.repository.test.ts`

**Step 1: Write the failing test**

Cover:
- initializes zvec collection
- upserts rows
- deletes rows by `nodeId`
- searches by query vector
- rejects mixed embedding dimensions

**Step 2: Run test to verify it fails**

Run: `bun test packages/indexing/src/vector.repository.test.ts`
Expected: FAIL because repository is missing.

**Step 3: Write minimal implementation**

Implement a zvec-backed repository that stores:
- `chunkId`
- vector
- metadata required for result reconstruction and node deletion filtering

Add dimension consistency checks before write.

**Step 4: Run test to verify it passes**

Run: `bun test packages/indexing/src/vector.repository.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src/vector.repository.*
git commit -m "feat(indexing): add zvec repository adapter"
```

### Task 7: Implement Node Reindex Flow

**Files:**
- Create: `packages/indexing/src/indexing.service.ts`
- Test: `packages/indexing/src/indexing.index.test.ts`

**Step 1: Write the failing test**

Add service tests that:
- index one node from `AsyncIterable<ParseChunk>`
- skip non-`ok` chunks
- replace old rows for the same `nodeId`
- return indexed count

Use a fake embedding provider that returns deterministic vectors.

**Step 2: Run test to verify it fails**

Run: `bun test packages/indexing/src/indexing.index.test.ts`
Expected: FAIL because service flow is missing.

**Step 3: Write minimal implementation**

Implement `index()`:
- materialize valid chunks
- delete old FTS/vector rows for the node
- embed chunk text
- write FTS rows
- write vector rows

Generate stable `chunkId` from `nodeId + chunkIndex`.

**Step 4: Run test to verify it passes**

Run: `bun test packages/indexing/src/indexing.index.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src/indexing.service.ts packages/indexing/src/indexing.index.test.ts
git commit -m "feat(indexing): add node reindex flow"
```

### Task 8: Implement Node Deletion Flow

**Files:**
- Modify: `packages/indexing/src/indexing.service.ts`
- Test: `packages/indexing/src/indexing.delete.test.ts`

**Step 1: Write the failing test**

Cover:
- `delete({ nodeId })` removes both FTS and vector rows
- deleting a missing node is a no-op

**Step 2: Run test to verify it fails**

Run: `bun test packages/indexing/src/indexing.delete.test.ts`
Expected: FAIL because delete flow is incomplete.

**Step 3: Write minimal implementation**

Implement `delete()` to delegate to both repositories and remain idempotent.

**Step 4: Run test to verify it passes**

Run: `bun test packages/indexing/src/indexing.delete.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src/indexing.service.ts packages/indexing/src/indexing.delete.test.ts
git commit -m "feat(indexing): add node delete flow"
```

### Task 9: Implement Hybrid Search

**Files:**
- Modify: `packages/indexing/src/indexing.service.ts`
- Test: `packages/indexing/src/indexing.search.test.ts`

**Step 1: Write the failing test**

Cover:
- returns `hybrid`, `fts`, `vector`, `reranked`, `meta`
- merges rows by `chunkId`
- empty query returns empty result sets
- `titleOnly` skips vector and only searches title fields
- score buckets populate `scores.fts`, `scores.vector`, `scores.fused`

**Step 2: Run test to verify it fails**

Run: `bun test packages/indexing/src/indexing.search.test.ts`
Expected: FAIL because search flow is missing or partial.

**Step 3: Write minimal implementation**

Implement `search()`:
- FTS lookup
- optional query embedding + vector lookup
- score normalization
- merge by `chunkId`
- build final `SearchResultSet`

**Step 4: Run test to verify it passes**

Run: `bun test packages/indexing/src/indexing.search.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src/indexing.service.ts packages/indexing/src/indexing.search.test.ts
git commit -m "feat(indexing): add hybrid search"
```

### Task 10: Add Optional Reranking

**Files:**
- Modify: `packages/indexing/src/indexing.service.ts`
- Test: `packages/indexing/src/indexing.rerank.test.ts`

**Step 1: Write the failing test**

Cover:
- reranker receives fused rows and `topK`
- `reranked` differs from `hybrid` when provider is enabled
- fallback behavior when reranker is absent

**Step 2: Run test to verify it fails**

Run: `bun test packages/indexing/src/indexing.rerank.test.ts`
Expected: FAIL because rerank stage is missing.

**Step 3: Write minimal implementation**

Integrate optional reranker after fusion and before final `hybrid` output.

**Step 4: Run test to verify it passes**

Run: `bun test packages/indexing/src/indexing.rerank.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src/indexing.service.ts packages/indexing/src/indexing.rerank.test.ts
git commit -m "feat(indexing): add optional reranking"
```

### Task 11: Add End-to-End Package Tests

**Files:**
- Test: `packages/indexing/src/indexing.e2e.test.ts`

**Step 1: Write the failing test**

Build an in-package integration test with:
- a stub embedding provider
- a stub reranker provider
- one `VfsNode`
- a multi-chunk `AsyncIterable<ParseChunk>`

Assert that indexing and searching return consistent metadata and debug outputs.

**Step 2: Run test to verify it fails**

Run: `bun test packages/indexing/src/indexing.e2e.test.ts`
Expected: FAIL until all wiring is complete.

**Step 3: Write minimal implementation**

Fix only the missing integration glue surfaced by the test. Do not expand the API.

**Step 4: Run test to verify it passes**

Run: `bun test packages/indexing/src/indexing.e2e.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src/indexing.e2e.test.ts packages/indexing/src
git commit -m "test(indexing): add end-to-end package coverage"
```

### Task 12: Verify Full Package

**Files:**
- Modify: `packages/indexing/src/index.ts`
- Test: `packages/indexing/src/*.test.ts`

**Step 1: Run focused package suite**

Run: `bun test packages/indexing/src`
Expected: PASS with zero failures.

**Step 2: Run workspace regression checks**

Run: `bun test packages/parser/src packages/vfs/src packages/indexing/src`
Expected: PASS with zero failures.

**Step 3: Final export cleanup**

Ensure `packages/indexing/src/index.ts` exports only the intended public API.

**Step 4: Re-run verification**

Run: `bun test packages/indexing/src`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing
git commit -m "chore(indexing): finalize package exports and verification"
```
