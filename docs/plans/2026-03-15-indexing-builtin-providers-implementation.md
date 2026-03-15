# indexing built-in providers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add built-in local/openai/qwen embedding providers and local reranker support to `packages/indexing`, plus a `CoreConfig`-driven indexing service creation entrypoint.

**Architecture:** Keep `packages/indexing` registry-based. Add provider factories under `embedding/providers` and `rerank/providers`, then add a built-in registration helper and a config-driven entrypoint that reads `CoreConfig` and `ModelService` from the dependency container and delegates to the existing `createIndexingService()`.

**Tech Stack:** Bun, TypeScript, `@knowdisk/core`, `@knowdisk/model`, `tsyringe`, package-level tests with `bun test`

---

### Task 1: Entry Points

**Files:**

- Modify: `packages/indexing/package.json`
- Modify: `packages/indexing/src/index.ts`
- Create: `packages/indexing/src/indexing.builtins.test.ts`
- Create: `packages/indexing/src/builtins/register-builtins.ts`
- Create: `packages/indexing/src/builtins/create-indexing-service-from-config.ts`

**Step 1: Write the failing test**

Add a package test that asserts:

- `registerBuiltInProviders`
- `createIndexingServiceFromConfig`

are exported from `packages/indexing/src/index.ts`.

**Step 2: Run test to verify it fails**

Run: `bun test packages/indexing/src/indexing.builtins.test.ts`
Expected: FAIL because the exports do not exist.

**Step 3: Write minimal implementation**

- add workspace dependencies on `@knowdisk/core` and `@knowdisk/model`
- add stub built-in files
- export them from the package root

**Step 4: Run test to verify it passes**

Run: `bun test packages/indexing/src/indexing.builtins.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/package.json packages/indexing/src/index.ts packages/indexing/src/indexing.builtins.test.ts packages/indexing/src/builtins/register-builtins.ts packages/indexing/src/builtins/create-indexing-service-from-config.ts
git commit -m "feat(indexing): add built-in entrypoints"
```

### Task 2: Local Providers

**Files:**

- Create: `packages/indexing/src/embedding/providers/local.embedding.ts`
- Create: `packages/indexing/src/embedding/providers/local.embedding.test.ts`
- Create: `packages/indexing/src/rerank/providers/local.reranker.ts`
- Create: `packages/indexing/src/rerank/providers/local.reranker.test.ts`

**Step 1: Write the failing tests**

Add tests for:

- local embedding uses `ModelService.getLocalEmbeddingExtractor()`
- local reranker uses `ModelService.getLocalRerankerRuntime()`

**Step 2: Run tests to verify they fail**

Run:

```bash
bun test packages/indexing/src/embedding/providers/local.embedding.test.ts packages/indexing/src/rerank/providers/local.reranker.test.ts
```

Expected: FAIL because the providers do not exist.

**Step 3: Write minimal implementation**

Implement:

- `createLocalEmbeddingProvider(container, options?)`
- `createLocalRerankerProvider(container)`

**Step 4: Run tests to verify they pass**

Run the same commands again.
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src/embedding/providers/local.embedding.ts packages/indexing/src/embedding/providers/local.embedding.test.ts packages/indexing/src/rerank/providers/local.reranker.ts packages/indexing/src/rerank/providers/local.reranker.test.ts
git commit -m "feat(indexing): add local providers"
```

### Task 3: Hosted Embedding Providers

**Files:**

- Create: `packages/indexing/src/embedding/providers/openai.embedding.ts`
- Create: `packages/indexing/src/embedding/providers/openai.embedding.test.ts`
- Create: `packages/indexing/src/embedding/providers/qwen.embedding.ts`
- Create: `packages/indexing/src/embedding/providers/qwen.embedding.test.ts`

**Step 1: Write the failing tests**

Add tests for:

- OpenAI embedding provider posts to configured endpoint and parses embedding vector
- Qwen embedding provider posts to configured endpoint and parses embedding vector

**Step 2: Run tests to verify they fail**

Run:

```bash
bun test packages/indexing/src/embedding/providers/openai.embedding.test.ts packages/indexing/src/embedding/providers/qwen.embedding.test.ts
```

Expected: FAIL because the providers do not exist.

**Step 3: Write minimal implementation**

Implement:

- `createOpenAiEmbeddingProvider(container)`
- `createQwenEmbeddingProvider(container)`

Both should validate required config and use container-provided `fetch` when present.

**Step 4: Run tests to verify they pass**

Run the same commands again.
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src/embedding/providers/openai.embedding.ts packages/indexing/src/embedding/providers/openai.embedding.test.ts packages/indexing/src/embedding/providers/qwen.embedding.ts packages/indexing/src/embedding/providers/qwen.embedding.test.ts
git commit -m "feat(indexing): add hosted embedding providers"
```

### Task 4: Built-in Registration

**Files:**

- Modify: `packages/indexing/src/builtins/register-builtins.ts`
- Create: `packages/indexing/src/builtins/register-builtins.test.ts`

**Step 1: Write the failing test**

Assert `registerBuiltInProviders()` registers:

- embedding: `local`, `openai`, `qwen`
- reranker: `local`

**Step 2: Run test to verify it fails**

Run: `bun test packages/indexing/src/builtins/register-builtins.test.ts`
Expected: FAIL because registration is empty.

**Step 3: Write minimal implementation**

Register the four provider factories with the given registries.

**Step 4: Run test to verify it passes**

Run: `bun test packages/indexing/src/builtins/register-builtins.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src/builtins/register-builtins.ts packages/indexing/src/builtins/register-builtins.test.ts
git commit -m "feat(indexing): add built-in provider registration"
```

### Task 5: Config-Driven Service Creation

**Files:**

- Modify: `packages/indexing/src/builtins/create-indexing-service-from-config.ts`
- Create: `packages/indexing/src/builtins/create-indexing-service-from-config.test.ts`

**Step 1: Write the failing test**

Add a test that:

- registers `CoreConfig`
- registers stub `ModelService`
- builds the service through `createIndexingServiceFromConfig()`
- verifies `meta.embeddingProvider` and `meta.rerankerProvider`

**Step 2: Run test to verify it fails**

Run: `bun test packages/indexing/src/builtins/create-indexing-service-from-config.test.ts`
Expected: FAIL because the config-driven entrypoint is not implemented.

**Step 3: Write minimal implementation**

Implement:

- `CoreConfig` resolution
- registry creation
- built-in registration
- provider selection
- delegation to `createIndexingService()`

**Step 4: Run test to verify it passes**

Run: `bun test packages/indexing/src/builtins/create-indexing-service-from-config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src/builtins/create-indexing-service-from-config.ts packages/indexing/src/builtins/create-indexing-service-from-config.test.ts
git commit -m "feat(indexing): add config-driven service creation"
```

### Task 6: Provider Error Coverage

**Files:**

- Modify: `packages/indexing/src/embedding/providers/local.embedding.test.ts`
- Modify: `packages/indexing/src/rerank/providers/local.reranker.test.ts`
- Modify: `packages/indexing/src/embedding/providers/openai.embedding.test.ts`
- Modify: `packages/indexing/src/embedding/providers/qwen.embedding.test.ts`
- Modify provider files as needed

**Step 1: Write the failing tests**

Add tests for:

- missing `ModelService` in local providers
- missing hosted provider config for OpenAI/Qwen

**Step 2: Run tests to verify they fail**

Run:

```bash
bun test packages/indexing/src/embedding/providers packages/indexing/src/rerank/providers
```

Expected: FAIL because local providers leak raw container errors or hosted providers do not validate clearly.

**Step 3: Write minimal implementation**

Add explicit error guards in provider factories.

**Step 4: Run tests to verify they pass**

Run the same commands again.
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src/embedding/providers packages/indexing/src/rerank/providers
git commit -m "test(indexing): add provider error coverage"
```

### Task 7: Integration Coverage

**Files:**

- Modify: `packages/indexing/src/indexing.e2e.test.ts`

**Step 1: Write the failing test**

Add a second end-to-end test that:

- creates a child container
- registers `CoreConfig`
- registers stub `ModelService`
- uses `createIndexingServiceFromConfig()`
- indexes a node and searches
- verifies built-in provider metadata

**Step 2: Run test to verify it fails**

Run: `bun test packages/indexing/src/indexing.e2e.test.ts`
Expected: FAIL until wiring is complete.

**Step 3: Write minimal implementation**

Only fix any remaining gaps needed for the test to pass.

**Step 4: Run test to verify it passes**

Run: `bun test packages/indexing/src/indexing.e2e.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/indexing/src/indexing.e2e.test.ts packages/indexing/src/index.ts
git commit -m "test(indexing): add built-in integration coverage"
```

### Task 8: Verification

**Files:**

- Test: `packages/indexing/src/**/*`

**Step 1: Run indexing tests**

Run: `bun test packages/indexing/src`
Expected: PASS

**Step 2: Run regression tests**

Run: `bun test packages/model/src packages/core/src packages/indexing/src`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/indexing
git commit -m "test(indexing): verify built-in providers and regressions"
```
