# packages/core Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract a new `packages/core` package that provides shared `logger` and minimal package-scoped `config` primitives for package consumers.

**Architecture:** Build `packages/core` as a standalone package with pure modules only. Keep `config` limited to types, defaults, validation, and optional merge helpers; do not pull in persistence or any `src/*` application concerns. Reuse existing logger behavior, then define a new package-only config contract that separates capability selection from third-party provider settings.

**Tech Stack:** Bun, TypeScript, existing monorepo package conventions, `bun test`, `pino`

---

### Task 1: Create `packages/core` package skeleton

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/src/core.package.test.ts`
- Reference: `packages/indexing/package.json`
- Reference: `packages/indexing/tsconfig.json`

**Step 1: Write the failing test**

Create `packages/core/src/core.package.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import * as core from "./index";

describe("@knowdisk/core package", () => {
  it("exports logger and config entry points", () => {
    expect(core).toHaveProperty("createLoggerService");
    expect(core).toHaveProperty("createDefaultCoreConfig");
    expect(core).toHaveProperty("validateCoreConfig");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/core.package.test.ts`
Expected: FAIL because `packages/core` files do not exist yet.

**Step 3: Write minimal implementation**

- Create `packages/core/package.json` using `packages/indexing/package.json` as the template, with package name `@knowdisk/core`
- Create `packages/core/tsconfig.json` using the same package conventions as `packages/indexing/tsconfig.json`
- Create `packages/core/src/index.ts` with temporary stub exports:

```ts
export function createLoggerService() {
  throw new Error("Not implemented");
}

export function createDefaultCoreConfig() {
  throw new Error("Not implemented");
}

export function validateCoreConfig() {
  throw new Error("Not implemented");
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/core.package.test.ts`
Expected: PASS because the names now exist.

**Step 5: Commit**

```bash
git add packages/core/package.json packages/core/tsconfig.json packages/core/src/index.ts packages/core/src/core.package.test.ts
git commit -m "feat(core): add package skeleton"
```

### Task 2: Move logger into `packages/core`

**Files:**
- Create: `packages/core/src/logger/index.ts`
- Create: `packages/core/src/logger/logger.service.ts`
- Create: `packages/core/src/logger/logger.service.types.ts`
- Create: `packages/core/src/logger/logger.service.test.ts`
- Modify: `packages/core/src/index.ts`
- Reference: `src/core/logger/logger.service.ts`
- Reference: `src/core/logger/logger.service.types.ts`

**Step 1: Write the failing test**

Create `packages/core/src/logger/logger.service.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { createLoggerService } from "./index";

describe("createLoggerService", () => {
  it("applies default name and default level", () => {
    const logger = createLoggerService();
    const bindings = logger.bindings();

    expect(bindings.name).toBe("knowdisk");
    expect(logger.level).toBe("info");
  });

  it("supports overriding name and level", () => {
    const logger = createLoggerService({ name: "core-test", level: "debug" });
    const bindings = logger.bindings();

    expect(bindings.name).toBe("core-test");
    expect(logger.level).toBe("debug");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/logger/logger.service.test.ts`
Expected: FAIL because the logger module is not implemented.

**Step 3: Write minimal implementation**

- Copy the existing logger service logic from `src/core/logger/logger.service.ts`
- Copy the logger type definition from `src/core/logger/logger.service.types.ts`
- Create `packages/core/src/logger/index.ts` that re-exports the service and types
- Update `packages/core/src/index.ts` to export from `./logger`

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/logger/logger.service.test.ts packages/core/src/core.package.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/logger/index.ts packages/core/src/logger/logger.service.ts packages/core/src/logger/logger.service.types.ts packages/core/src/logger/logger.service.test.ts
git commit -m "feat(core): add shared logger module"
```

### Task 3: Define the core config contract

**Files:**
- Create: `packages/core/src/config/index.ts`
- Create: `packages/core/src/config/config.types.ts`
- Create: `packages/core/src/config/config.types.test.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

Create `packages/core/src/config/config.types.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { CoreConfig } from "./config.types";

describe("CoreConfig", () => {
  it("supports provider selection separately from provider settings", () => {
    const config: CoreConfig = {
      logger: { level: "info", name: "knowdisk" },
      providers: {
        openai: {
          endpoint: "https://api.openai.com",
          apiKey: "secret",
          embeddingModel: "text-embedding-3-small",
        },
        huggingface: {
          endpoint: "https://hf-mirror.com",
        },
      },
      embedding: {
        provider: "openai",
      },
      reranker: {
        enabled: false,
        provider: "local",
        local: { model: "Xenova/bge-reranker-base", topN: 5 },
      },
      chat: {
        provider: "openai",
      },
    };

    expect(config.providers.openai?.endpoint).toBe("https://api.openai.com");
    expect(config.embedding.provider).toBe("openai");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/config/config.types.test.ts`
Expected: FAIL because config types do not exist.

**Step 3: Write minimal implementation**

Create `packages/core/src/config/config.types.ts` with:

- `OpenAiProviderConfig`
- `HuggingfaceProviderConfig`
- `QwenProviderConfig`
- `EmbeddingProviderId = "local" | "openai" | "qwen"`
- `RerankerProviderId = "local" | "openai" | "qwen"`
- `ChatProviderId = "openai"`
- `CoreConfig`

Create `packages/core/src/config/index.ts` to export the types.
Update `packages/core/src/index.ts` to re-export from `./config`.

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/config/config.types.test.ts packages/core/src/core.package.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/config/index.ts packages/core/src/config/config.types.ts packages/core/src/config/config.types.test.ts
git commit -m "feat(core): add core config types"
```

### Task 4: Add default config generation

**Files:**
- Create: `packages/core/src/config/default-config.ts`
- Create: `packages/core/src/config/default-config.test.ts`
- Modify: `packages/core/src/config/index.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

Create `packages/core/src/config/default-config.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { createDefaultCoreConfig } from "./index";

describe("createDefaultCoreConfig", () => {
  it("returns a package-scoped default config", () => {
    const config = createDefaultCoreConfig();

    expect(config.logger).toEqual({
      level: "info",
      name: "knowdisk",
    });
    expect(config.providers.huggingface?.endpoint).toBe("https://hf-mirror.com");
    expect(config.embedding.provider).toBe("local");
    expect(config.reranker.provider).toBe("local");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/config/default-config.test.ts`
Expected: FAIL because the function does not exist or throws.

**Step 3: Write minimal implementation**

Create `packages/core/src/config/default-config.ts`:

```ts
import type { CoreConfig } from "./config.types";

export function createDefaultCoreConfig(): CoreConfig {
  return {
    logger: {
      level: "info",
      name: "knowdisk",
    },
    providers: {
      openai: {
        endpoint: "https://api.openai.com",
        apiKey: "",
      },
      huggingface: {
        endpoint: "https://hf-mirror.com",
      },
      qwen: {
        endpoint: "",
        apiKey: "",
      },
    },
    embedding: {
      provider: "local",
      local: {
        model: "onnx-community/gte-multilingual-base",
        dimension: 768,
      },
    },
    reranker: {
      enabled: true,
      provider: "local",
      local: {
        model: "Xenova/bge-reranker-base",
        topN: 5,
      },
    },
    chat: {
      provider: "openai",
    },
  };
}
```

Update exports from `packages/core/src/config/index.ts` and `packages/core/src/index.ts`.

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/config/default-config.test.ts packages/core/src/config/config.types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/config/index.ts packages/core/src/config/default-config.ts packages/core/src/config/default-config.test.ts
git commit -m "feat(core): add default core config"
```

### Task 5: Add config validation

**Files:**
- Create: `packages/core/src/config/validate-config.ts`
- Create: `packages/core/src/config/validate-config.test.ts`
- Modify: `packages/core/src/config/index.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

Create `packages/core/src/config/validate-config.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  createDefaultCoreConfig,
  validateCoreConfig,
} from "./index";

describe("validateCoreConfig", () => {
  it("accepts the default config", () => {
    expect(validateCoreConfig(createDefaultCoreConfig())).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("requires openai credentials when openai embedding is selected", () => {
    const config = createDefaultCoreConfig();
    config.embedding.provider = "openai";
    config.providers.openai = {
      endpoint: "https://api.openai.com",
      apiKey: "",
    };

    expect(validateCoreConfig(config)).toEqual({
      ok: false,
      errors: ["providers.openai.apiKey is required for embedding.provider=openai"],
    });
  });

  it("requires qwen endpoint and key when qwen reranker is selected", () => {
    const config = createDefaultCoreConfig();
    config.reranker.provider = "qwen";
    config.providers.qwen = {
      endpoint: "",
      apiKey: "",
    };

    expect(validateCoreConfig(config)).toEqual({
      ok: false,
      errors: [
        "providers.qwen.endpoint is required for reranker.provider=qwen",
        "providers.qwen.apiKey is required for reranker.provider=qwen",
      ],
    });
  });

  it("requires local embedding settings for local provider", () => {
    const config = createDefaultCoreConfig();
    config.embedding.local = undefined;

    expect(validateCoreConfig(config)).toEqual({
      ok: false,
      errors: ["embedding.local is required for embedding.provider=local"],
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/config/validate-config.test.ts`
Expected: FAIL because validation is not implemented.

**Step 3: Write minimal implementation**

Create `packages/core/src/config/validate-config.ts`:

- export `validateCoreConfig(config: CoreConfig): { ok: boolean; errors: string[] }`
- validate:
  - `logger.level` and `logger.name` are non-empty
  - selected `embedding.provider` has the required local or hosted provider config
  - selected `reranker.provider` has the required local or hosted provider config
  - if `chat.provider === "openai"`, `providers.openai.endpoint` must be non-empty
  - `local.dimension > 0`
  - `local.topN > 0`
- collect all errors before returning

Update exports from `packages/core/src/config/index.ts` and `packages/core/src/index.ts`.

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/config/validate-config.test.ts packages/core/src/config/default-config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/config/index.ts packages/core/src/config/validate-config.ts packages/core/src/config/validate-config.test.ts
git commit -m "feat(core): add config validation"
```

### Task 6: Verify package exports and full core test suite

**Files:**
- Test: `packages/core/src/core.package.test.ts`
- Test: `packages/core/src/logger/logger.service.test.ts`
- Test: `packages/core/src/config/config.types.test.ts`
- Test: `packages/core/src/config/default-config.test.ts`
- Test: `packages/core/src/config/validate-config.test.ts`

**Step 1: Review package exports**

Ensure `packages/core/src/index.ts` exports:

```ts
export * from "./logger";
export * from "./config";
```

Ensure `packages/core/src/logger/index.ts` exports:

```ts
export { createLoggerService } from "./logger.service";
export type { LoggerService } from "./logger.service.types";
```

Ensure `packages/core/src/config/index.ts` exports:

```ts
export { createDefaultCoreConfig } from "./default-config";
export type { CoreConfig } from "./config.types";
export { validateCoreConfig } from "./validate-config";
```

**Step 2: Run full core tests**

Run: `bun test packages/core/src`
Expected: PASS

**Step 3: Run regression tests for likely consumers**

Run: `bun test packages/indexing/src`
Expected: PASS

**Step 4: Inspect package manifest**

Confirm `packages/core/package.json` fields match local package conventions:

- package name
- exports
- type/module settings
- test/build scripts if the repo standard requires them

**Step 5: Commit**

```bash
git add packages/core
git commit -m "test(core): verify shared package exports"
```

### Task 7: Optional follow-up adapter for `packages/indexing`

**Files:**
- Modify: `packages/indexing/src/index.ts`
- Create or Modify: an adapter file only if needed after Task 6
- Test: new indexing-side adapter tests only if the adapter is introduced

**Step 1: Decide if an adapter is actually needed**

If `packages/indexing` does not yet consume `packages/core`, skip this task entirely. Do not add speculative abstractions.

**Step 2: If needed, write a failing test first**

Only write a test if there is a real indexing entry point that now needs `CoreConfig`.

**Step 3: Add the smallest possible adapter**

Prefer a local pure function over a service class.

**Step 4: Run targeted tests**

Run only the new test plus `bun test packages/indexing/src`

**Step 5: Commit**

```bash
git add <only the touched indexing files>
git commit -m "feat(indexing): add core config adapter"
```

Skip this commit if no adapter was introduced.
