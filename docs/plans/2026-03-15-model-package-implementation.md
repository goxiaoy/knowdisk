# packages/model Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a reusable `packages/model` package that manages local model download, progress/status subscription, and local embedding/reranker runtime access for package consumers.

**Architecture:** Build `packages/model` as a standalone package that depends only on `@knowdisk/core` and package-level runtime/download libraries. The package owns its internal queue, retry policy, status store, and runtime guards, while the host provides only `logger`, `config`, and `cacheDir`.

**Tech Stack:** Bun, TypeScript, `@knowdisk/core`, package-level tests with `bun test`, Hugging Face style HTTP downloads, local ONNX runtime helpers already used by the repo

---

### Task 1: Package Skeleton

**Files:**
- Create: `packages/model/package.json`
- Create: `packages/model/src/index.ts`
- Test: `packages/model/src/model.package.test.ts`

**Step 1: Write the failing test**

Add a package smoke test that asserts `createModelService` is exported.

**Step 2: Run test to verify it fails**

Run: `bun test packages/model/src/model.package.test.ts`
Expected: FAIL because the package does not exist yet.

**Step 3: Write minimal implementation**

- Add `packages/model/package.json`
- Export a stub `createModelService`

**Step 4: Run test to verify it passes**

Run: `bun test packages/model/src/model.package.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/model
git commit -m "feat(model): add package skeleton"
```

### Task 2: Public Types

**Files:**
- Create: `packages/model/src/model.service.types.ts`
- Test: `packages/model/src/model.service.types.test.ts`
- Modify: `packages/model/src/index.ts`

**Step 1: Write the failing test**

Add a type-level contract test for:

- `ModelService`
- `ModelDownloadStatus`
- separate `redownloadEmbeddingModel` and `redownloadRerankerModel`

**Step 2: Run test to verify it fails**

Run: `bun test packages/model/src/model.service.types.test.ts`
Expected: FAIL because the types do not exist.

**Step 3: Write minimal implementation**

Define:

- `CreateModelServiceInput`
- `ModelService`
- status/task/runtime types

**Step 4: Run test to verify it passes**

Run: `bun test packages/model/src/model.service.types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/model/src/index.ts packages/model/src/model.service.types.ts packages/model/src/model.service.types.test.ts
git commit -m "feat(model): add model service types"
```

### Task 3: Service Shell

**Files:**
- Create: `packages/model/src/model.service.ts`
- Test: `packages/model/src/model.service.test.ts`

**Step 1: Write the failing test**

Assert `createModelService()` exposes an idle status snapshot with empty tasks and retry metadata.

**Step 2: Run test to verify it fails**

Run: `bun test packages/model/src/model.service.test.ts`
Expected: FAIL because the service shell is not implemented.

**Step 3: Write minimal implementation**

Implement:

- `EMPTY_STATUS`
- `getStatus().getSnapshot()`
- `getStatus().subscribe()`
- method stubs for download/runtime APIs

**Step 4: Run test to verify it passes**

Run: `bun test packages/model/src/model.service.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/model/src/model.service.ts packages/model/src/model.service.test.ts
git commit -m "feat(model): add model service shell"
```

### Task 4: Status And Task Planning

**Files:**
- Test: `packages/model/src/model.status.test.ts`
- Test: `packages/model/src/model.specs.test.ts`
- Modify: `packages/model/src/model.service.ts`

**Step 1: Write the failing tests**

Add tests for:

- listener notification on status changes
- local task planning for embedding and reranker

**Step 2: Run tests to verify they fail**

Run: `bun test packages/model/src/model.status.test.ts packages/model/src/model.specs.test.ts`
Expected: FAIL because the service does not emit state changes or populate tasks.

**Step 3: Write minimal implementation**

Implement:

- `emit()` and `updateStatus()`
- local task planning from `CoreConfig`
- `ensureRequiredModels()` state transitions

**Step 4: Run tests to verify they pass**

Run: `bun test packages/model/src/model.status.test.ts packages/model/src/model.specs.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/model/src/model.service.ts packages/model/src/model.status.test.ts packages/model/src/model.specs.test.ts
git commit -m "feat(model): add status store and task planning"
```

### Task 5: Download Helpers

**Files:**
- Test: `packages/model/src/model.download.test.ts`
- Modify: `packages/model/src/model.service.ts`

**Step 1: Write the failing test**

Add a test for `selectPreferredRepoFiles()` that keeps only required model files and `onnx/model.onnx*`.

**Step 2: Run test to verify it fails**

Run: `bun test packages/model/src/model.download.test.ts`
Expected: FAIL because the helper does not exist.

**Step 3: Write minimal implementation**

Implement `selectPreferredRepoFiles()`.

**Step 4: Run test to verify it passes**

Run: `bun test packages/model/src/model.download.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/model/src/model.service.ts packages/model/src/model.download.test.ts
git commit -m "feat(model): add repo file selection"
```

### Task 6: Retry And Progress

**Files:**
- Test: `packages/model/src/model.retry.test.ts`
- Modify: `packages/model/src/model.service.ts`

**Step 1: Write the failing tests**

Add tests for:

- retry metadata after download failure
- progress updates during download

**Step 2: Run tests to verify they fail**

Run: `bun test packages/model/src/model.retry.test.ts`
Expected: FAIL because the service does not download files or manage retries.

**Step 3: Write minimal implementation**

Implement:

- repo listing via fetch
- file download to `cacheDir`
- progress accumulation
- retry metadata and retry scheduling

**Step 4: Run tests to verify they pass**

Run: `bun test packages/model/src/model.retry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/model/src/model.service.ts packages/model/src/model.retry.test.ts
git commit -m "feat(model): add retry and progress tracking"
```

### Task 7: Runtime Acquisition

**Files:**
- Test: `packages/model/src/model.runtime.test.ts`
- Modify: `packages/model/src/model.service.ts`
- Modify: `packages/model/package.json`

**Step 1: Write the failing tests**

Add tests for:

- non-local embedding rejection
- concurrent embedding runtime guard
- concurrent reranker runtime guard

**Step 2: Run tests to verify they fail**

Run: `bun test packages/model/src/model.runtime.test.ts`
Expected: FAIL because runtime acquisition is not implemented.

**Step 3: Write minimal implementation**

Implement:

- `getLocalEmbeddingExtractor()`
- `getLocalRerankerRuntime()`
- default loaders using `@huggingface/transformers`
- promise guards to deduplicate concurrent initialization

**Step 4: Run tests to verify they pass**

Run: `bun test packages/model/src/model.runtime.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/model/package.json packages/model/src/model.service.ts packages/model/src/model.runtime.test.ts
git commit -m "feat(model): add local runtime acquisition"
```

### Task 8: Separate Redownload APIs

**Files:**
- Test: `packages/model/src/model.redownload.test.ts`
- Modify: `packages/model/src/model.service.ts`

**Step 1: Write the failing tests**

Add tests for:

- `redownloadEmbeddingModel()`
- `redownloadRerankerModel()`

**Step 2: Run tests to verify they fail**

Run: `bun test packages/model/src/model.redownload.test.ts`
Expected: FAIL because redownload APIs are not implemented.

**Step 3: Write minimal implementation**

Implement cache clearing and rerun the relevant scope only.

**Step 4: Run tests to verify they pass**

Run: `bun test packages/model/src/model.redownload.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/model/src/model.service.ts packages/model/src/model.redownload.test.ts
git commit -m "feat(model): add separate redownload APIs"
```

### Task 9: Verification

**Files:**
- Test: `packages/model/src/*`

**Step 1: Run package tests**

Run: `bun test packages/model/src`
Expected: PASS

**Step 2: Run regression tests**

Run: `bun test packages/model/src packages/core/src packages/indexing/src`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/model
git commit -m "test(model): verify package exports and regressions"
```
