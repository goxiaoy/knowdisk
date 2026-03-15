# packages/model Design

## Goal

Add a new `packages/model` package that provides package-scoped local model management:

- local model download
- progress and status subscription
- local embedding runtime acquisition
- local reranker runtime acquisition

This package is scoped to `packages/` only. It does not migrate or adapt the existing `src/core/model` implementation.

## Scope

In scope:

- Create a standalone `packages/model` package
- Provide a package-level model service
- Download required local model files from Hugging Face style endpoints
- Expose status snapshots and progress listeners
- Expose local embedding and reranker runtime access
- Support explicit retry and per-model redownload operations

Out of scope:

- Migrating `src/core/model/*`
- Reworking application-level config or trigger flows
- Adding cloud embedding or cloud reranker runtime support

## Design

### Package API

`packages/model` exposes a single service factory and related types:

```ts
createModelService({
  logger,
  config,
  cacheDir,
})
```

Public service contract:

```ts
type ModelService = {
  ensureRequiredModels(): Promise<void>;
  getLocalEmbeddingExtractor(): Promise<LocalEmbeddingExtractor>;
  getLocalRerankerRuntime(): Promise<LocalRerankerRuntime>;
  retryNow(): Promise<{ ok: boolean }>;
  redownloadEmbeddingModel(): Promise<{ ok: boolean }>;
  redownloadRerankerModel(): Promise<{ ok: boolean }>;
  getStatus(): ModelDownloadStatusStore;
};
```

### Configuration boundary

The service accepts:

- `logger`: shared logger from `@knowdisk/core`
- `config`: `CoreConfig`
- `cacheDir`: string

Rules:

- `config` is read directly from `@knowdisk/core`
- `cacheDir` is passed separately and is not added to `CoreConfig`
- the package only reads:
  - `config.providers`
  - `config.embedding`
  - `config.reranker`

### Status and progress model

The package owns download state internally and exposes it through a status store.

The status contract keeps:

- overall phase: `idle | verifying | running | completed | failed`
- aggregate progress percentage
- overall error
- per-task state for:
  - `embedding`
  - `reranker`

Each task includes:

- state
- progress percentage
- downloaded bytes
- total bytes
- error

This preserves package-level progress listening without requiring the host to compose state.

### Download behavior

The package manages only local models.

Download source:

- `config.providers.huggingface.endpoint`

Download rules:

- only download when `embedding.provider === "local"` or `reranker.provider === "local"`
- select only required model files and sidecars
- keep concurrent file download support
- keep retry behavior for transient failures
- support redownloading embedding and reranker models independently

### Runtime acquisition

The package exposes:

- `getLocalEmbeddingExtractor()`
- `getLocalRerankerRuntime()`

Rules:

- runtime acquisition is available only when the corresponding provider is `local`
- downloaded files are verified before runtime load
- runtime creation is guarded to avoid duplicate concurrent initialization

### Package layout

Suggested structure:

```text
packages/model/
  package.json
  src/
    index.ts
    model.service.ts
    model.service.types.ts
    model.service.test.ts
    model.download.test.ts
    model.runtime.test.ts
```

## Dependency boundaries

`packages/model` must:

- depend on `@knowdisk/core`
- avoid importing from `src/*`
- avoid application persistence or trigger logic
- keep host interaction limited to logger, config, and cache directory

## Testing

Minimum coverage:

- package export smoke test
- default idle status shape
- download file selection
- retry behavior
- status/progress subscription
- embedding model download path
- reranker model download path
- embedding runtime acquisition
- reranker runtime acquisition
- independent redownload APIs for embedding and reranker

## Rationale

This design keeps `packages/model` reusable and host-agnostic:

- the host supplies config and cache location, but not state machinery
- local model lifecycle stays in one package
- progress listening is first-class
- embedding and reranker redownload flows are explicit and separate
