# indexing built-in providers Design

## Goal

Extend `packages/indexing` with built-in providers and a config-driven service creation entrypoint.

Built-in support:

- embedding: `local`, `openai`, `qwen`
- reranker: `local`

The package should support automatic provider registration and service wiring from `CoreConfig`, using the dependency container for shared dependencies.

## Scope

In scope:

- Add built-in embedding providers to `packages/indexing`
- Add built-in local reranker provider to `packages/indexing`
- Add automatic provider registration
- Add `CoreConfig`-driven indexing service creation
- Read shared config and model services from the dependency container

Out of scope:

- Adding OpenAI or Qwen reranker support
- Changing the low-level `createIndexingService()` API contract
- Migrating application-layer code outside `packages/`

## Design

### New built-in providers

Built-in embedding providers:

- `local`
- `openai`
- `qwen`

Built-in reranker providers:

- `local`

Provider type names intentionally match `CoreConfig` values to avoid extra mapping complexity.

### Package structure

Suggested additions:

```text
packages/indexing/src/
  builtins/
    register-builtins.ts
    create-indexing-service-from-config.ts
  embedding/
    providers/
      local.embedding.ts
      openai.embedding.ts
      qwen.embedding.ts
  rerank/
    providers/
      local.reranker.ts
```

### Dependency container usage

The built-in providers may read these dependencies from the container:

- `CoreConfig`
- `ModelService`
- logger
- optional `fetch` implementation for HTTP providers

Rules:

- local providers use `ModelService`
- hosted providers use `CoreConfig.providers.*`
- all provider-specific configuration lookup is localized inside provider factories

### Automatic registration

Add a built-in registration helper:

```ts
registerBuiltInProviders(container, {
  embeddingRegistry,
  rerankerRegistry,
})
```

This function registers:

- embedding `local`
- embedding `openai`
- embedding `qwen`
- reranker `local`

It does not create the indexing service by itself.

### Config-driven indexing entrypoint

Add a higher-level entrypoint:

```ts
createIndexingServiceFromConfig(container, {
  logger,
  ftsRepository,
  vectorRepository,
  defaults,
})
```

Responsibilities:

- read `CoreConfig` from container
- create or use registries
- call `registerBuiltInProviders()`
- map `CoreConfig.embedding.provider` directly to the embedding provider type
- enable reranker only when:
  - `config.reranker.enabled === true`
  - `config.reranker.provider === "local"`
- delegate final construction to the existing `createIndexingService()`

This preserves the low-level registry-based API while adding a package-level opinionated entrypoint.

### Provider behavior

#### Local embedding

- read `ModelService` from container
- call `getLocalEmbeddingExtractor()`
- convert extractor output to `number[]`
- expose `dimension` from `config.embedding.local.dimension`

#### Local reranker

- read `ModelService` from container
- call `getLocalRerankerRuntime()`
- tokenize `(query, docs)`
- score and sort descending
- return top `opts.topK`

#### OpenAI embedding

- read `config.providers.openai`
- require:
  - `endpoint`
  - `apiKey`
  - `embeddingModel`
- call the OpenAI embeddings API
- parse and return the first embedding vector

#### Qwen embedding

- read `config.providers.qwen`
- require:
  - `endpoint`
  - `apiKey`
  - `embeddingModel`
- call the Qwen embeddings API
- parse and return the first embedding vector

### Error handling

Fail fast with explicit errors when:

- `CoreConfig` is missing from container
- `ModelService` is missing for local providers
- hosted provider config is incomplete
- HTTP response is not successful
- response payload does not contain an embedding vector
- returned embedding dimensions are invalid

Error messages should name the provider and missing field or failed operation.

## Testing

Minimum coverage:

- built-in registration exposes expected provider types
- config-driven service creation selects the right embedding provider
- config-driven service creation enables local reranker only when configured
- local embedding provider calls `ModelService.getLocalEmbeddingExtractor()`
- local reranker provider calls `ModelService.getLocalRerankerRuntime()`
- openai embedding provider makes the expected request and parses the vector
- qwen embedding provider makes the expected request and parses the vector
- missing provider config throws clear errors
- one indexing integration test goes through `createIndexingServiceFromConfig()`

## Rationale

This design keeps the current registry-based indexing architecture intact while adding package-owned defaults:

- built-in providers are easy to use out of the box
- custom providers still work through the existing registries
- service construction remains explicit
- provider-specific concerns stay outside `indexing.service.ts`
