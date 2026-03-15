# packages/core Design

## Goal

Extract a new `packages/core` package that contains only shared package-level primitives:

- `logger`
- `config`

This package is scoped to `packages/` only. It does not migrate or adapt the existing `src/` application config system.

## Scope

In scope:

- Create a standalone `packages/core` package
- Move shared logger code into `packages/core/logger`
- Define a minimal shared config model for package consumers
- Separate provider selection from third-party provider configuration

Out of scope:

- Migrating existing `src/core/*` modules
- Replacing desktop/mainview config persistence
- Adding file IO, localStorage, RPC, or other host-specific config storage logic

## Design

### Package layout

`packages/core` will expose:

- `logger`
- `config`

Suggested structure:

```text
packages/core/
  package.json
  src/
    index.ts
    logger/
      index.ts
      logger.service.ts
      logger.service.types.ts
    config/
      index.ts
      config.types.ts
      default-config.ts
      validate-config.ts
```

### Config model

`packages/core/config` defines a package-focused shared config shape:

```ts
type CoreConfig = {
  logger: {
    level: string;
    name: string;
  };
  providers: {
    openai?: {
      endpoint: string;
      apiKey: string;
      embeddingModel?: string;
      rerankModel?: string;
      chatModel?: string;
    };
    huggingface?: {
      endpoint: string;
    };
    qwen?: {
      endpoint: string;
      apiKey: string;
      embeddingModel?: string;
      rerankModel?: string;
    };
  };
  embedding: {
    provider: "local" | "openai" | "qwen";
    local?: {
      model: string;
      dimension: number;
    };
  };
  reranker: {
    enabled: boolean;
    provider: "local" | "openai" | "qwen";
    local?: {
      model: string;
      topN: number;
    };
  };
  chat?: {
    provider: "openai";
  };
};
```

### Separation rules

Rules for the config shape:

- `providers.*` owns all third-party connection and hosted-model settings
- `embedding`, `reranker`, and `chat` own capability selection only
- Local runtime settings stay in `embedding.local` and `reranker.local`
- Application-level config such as UI, sources, MCP, indexing, retrieval, and persistence is excluded

### Public API

`packages/core` should export:

- `createLoggerService`
- logger types
- `CoreConfig`
- `createDefaultCoreConfig`
- `validateCoreConfig`

Optional later addition:

- `mergeCoreConfig` as a pure helper if package consumers need layered overrides

## Dependency boundaries

`packages/core` must:

- avoid imports from `src/*`
- avoid host-specific persistence concerns
- stay usable from any package without Bun/Electron/localStorage coupling

## Testing

Minimum test coverage:

- logger default behavior
- logger option override behavior
- default core config shape
- config validation for missing provider credentials
- config validation for missing provider endpoints
- config validation for local provider settings

## Implementation notes

Recommended implementation order:

1. Create `packages/core` package skeleton and root exports
2. Move logger module into `packages/core/logger`
3. Add shared config types, defaults, and validation
4. Add tests for logger and config
5. Introduce package consumers later through explicit follow-up changes

## Rationale

This design keeps `packages/core` small and durable:

- package consumers get one shared config contract
- third-party settings stop leaking into capability-specific sections
- future packages can reuse the same provider definitions without inheriting app-specific config baggage
