import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import type {
  AppConfig,
  CloudEmbeddingConfig,
  CloudRerankerConfig,
  ConfigChangeEvent,
  ConfigService,
  LocalEmbeddingConfig,
  LocalRerankerConfig,
  SourceConfig,
} from "./config.types";
import { isCloudEmbeddingProvider } from "../embedding/embedding.types";

export function getDefaultConfig(): AppConfig {
  return getDefaultConfigWithPaths({});
}

function getDefaultConfigWithPaths(opts: { userDataDir?: string }): AppConfig {
  const embeddingCacheDir = opts.userDataDir
    ? join(opts.userDataDir, "cache", "embedding", "local")
    : "build/cache/embedding/local";
  const rerankerCacheDir = opts.userDataDir
    ? join(opts.userDataDir, "cache", "reranker", "local")
    : "build/cache/reranker/local";
  return {
    version: 1,
    onboarding: {
      completed: false,
    },
    sources: [],
    mcp: {
      enabled: true,
      port: 3467,
    },
    ui: { mode: "safe" },
    indexing: {
      watch: { enabled: true, debounceMs: 500 },
      reconcile: { enabled: true, intervalMs: 15 * 60 * 1000 },
      worker: { concurrency: 2, batchSize: 64 },
      retry: { maxAttempts: 3, backoffMs: [1000, 5000, 20000] },
    },
    retrieval: {
      hybrid: {
        ftsTopN: 30,
        vectorTopK: 20,
        rerankTopN: 10,
      },
    },
    embedding: {
      provider: "local",
      local: {
        hfEndpoint: "https://hf-mirror.com",
        cacheDir: embeddingCacheDir,
        model: "Xenova/all-MiniLM-L6-v2",
        dimension: 384,
      },
      qwen_dense: {
        apiKey: "",
        model: "text-embedding-v4",
        dimension: 1024,
      },
      qwen_sparse: {
        apiKey: "",
        model: "text-embedding-v4",
        dimension: 1024,
      },
      openai_dense: {
        apiKey: "",
        model: "text-embedding-3-small",
        dimension: 1536,
      },
    },
    reranker: {
      enabled: true,
      provider: "local",
      local: {
        hfEndpoint: "https://hf-mirror.com",
        cacheDir: rerankerCacheDir,
        model: "BAAI/bge-reranker-base",
        topN: 5,
      },
      qwen: {
        apiKey: "",
        model: "gte-rerank-v2",
        topN: 5,
      },
      openai: {
        apiKey: "",
        model: "text-embedding-3-small",
        topN: 5,
      },
    },
  };
}

export function validateConfig(cfg: AppConfig): {
  ok: boolean;
  errors: string[];
} {
  const mcpErrors = validateMcp(cfg.mcp);
  if (mcpErrors.length > 0) {
    return { ok: false, errors: mcpErrors };
  }

  const embeddingErrors = validateEmbedding(cfg.embedding);
  if (embeddingErrors.length > 0) {
    return { ok: false, errors: embeddingErrors };
  }

  const rerankerErrors = validateReranker(cfg.reranker);
  if (rerankerErrors.length > 0) {
    return { ok: false, errors: rerankerErrors };
  }

  return { ok: true, errors: [] };
}

function validateMcp(mcp: AppConfig["mcp"]): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(mcp.port) || mcp.port < 1 || mcp.port > 65535) {
    errors.push("mcp.port must be an integer between 1 and 65535");
  }
  return errors;
}

function normalizePositiveInt(
  value: unknown,
  fallback: number,
): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function normalizeBackoffMs(
  value: unknown,
  fallback: number[],
): number[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const normalized = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.floor(item));
  return normalized.length > 0 ? normalized : fallback;
}

function validateEmbedding(embedding: AppConfig["embedding"]): string[] {
  const errors: string[] = [];
  if (embedding.provider === "local") {
    if (embedding.local.dimension <= 0) {
      errors.push("embedding.local.dimension must be > 0");
    }
    if (!embedding.local.hfEndpoint) {
      errors.push("embedding.local.hfEndpoint is required");
    }
    if (!embedding.local.cacheDir) {
      errors.push("embedding.local.cacheDir is required");
    }
    return errors;
  }

  if (isCloudEmbeddingProvider(embedding.provider)) {
    const active = embedding[embedding.provider] as CloudEmbeddingConfig;
    if (!active.apiKey) {
      errors.push(`embedding.${embedding.provider}.apiKey is required`);
    }
    if (active.dimension <= 0) {
      errors.push(`embedding.${embedding.provider}.dimension must be > 0`);
    }
  }
  return errors;
}

function validateReranker(reranker: AppConfig["reranker"]): string[] {
  const errors: string[] = [];
  if (!reranker.enabled) {
    return errors;
  }

  if (reranker.provider === "local") {
    if (reranker.local.topN <= 0) {
      errors.push("reranker.local.topN must be > 0");
    }
    if (!reranker.local.hfEndpoint) {
      errors.push("reranker.local.hfEndpoint is required");
    }
    if (!reranker.local.cacheDir) {
      errors.push("reranker.local.cacheDir is required");
    }
    return errors;
  }

  const active = reranker[reranker.provider] as CloudRerankerConfig;
  if (!active.apiKey) {
    errors.push(`reranker.${reranker.provider}.apiKey is required`);
  }
  if (active.topN <= 0) {
    errors.push(`reranker.${reranker.provider}.topN must be > 0`);
  }
  return errors;
}

export function migrateConfig(input: unknown): AppConfig {
  return migrateConfigWithDefaults(input, getDefaultConfig());
}

function migrateConfigWithDefaults(
  input: unknown,
  defaults: AppConfig,
): AppConfig {
  const version = (input as { version?: number })?.version ?? 0;
  if (version === 1) {
    const next = input as Partial<AppConfig> & {
      modelHub?: { hfEndpoint?: string };
      embedding?: {
        provider?: AppConfig["embedding"]["provider"];
        endpoint?: string;
        apiKey?: string;
        apiKeys?: Record<string, string>;
        model?: string;
        dimension?: number;
      };
      reranker?: {
        mode?: "none" | "local";
        model?: string;
        topN?: number;
      };
    };

    const migratedSources =
      Array.isArray(next.sources) && next.sources.length > 0
        ? normalizeSources(next.sources as unknown[])
        : [];

    const embedding = mergeEmbedding(
      defaults.embedding,
      next.embedding,
      next.modelHub?.hfEndpoint,
    );
    const reranker = mergeReranker(
      defaults.reranker,
      next.reranker,
      next.modelHub?.hfEndpoint,
    );

    return {
      ...defaults,
      ...next,
      onboarding: {
        completed:
          next.onboarding?.completed ??
          (migratedSources.length > 0 ? true : defaults.onboarding.completed),
      },
      sources: migratedSources,
      mcp: {
        enabled: next.mcp?.enabled ?? true,
        port: normalizePort(next.mcp?.port, defaults.mcp.port),
      },
      indexing: {
        watch: {
          enabled: next.indexing?.watch?.enabled ?? defaults.indexing.watch.enabled,
          debounceMs: normalizePositiveInt(
            next.indexing?.watch?.debounceMs,
            defaults.indexing.watch.debounceMs,
          ),
        },
        reconcile: {
          enabled:
            next.indexing?.reconcile?.enabled ??
            defaults.indexing.reconcile.enabled,
          intervalMs: normalizePositiveInt(
            next.indexing?.reconcile?.intervalMs,
            defaults.indexing.reconcile.intervalMs,
          ),
        },
        worker: {
          concurrency: normalizePositiveInt(
            next.indexing?.worker?.concurrency,
            defaults.indexing.worker.concurrency,
          ),
          batchSize: normalizePositiveInt(
            next.indexing?.worker?.batchSize,
            defaults.indexing.worker.batchSize,
          ),
        },
        retry: {
          maxAttempts: normalizePositiveInt(
            next.indexing?.retry?.maxAttempts,
            defaults.indexing.retry.maxAttempts,
          ),
          backoffMs: normalizeBackoffMs(
            next.indexing?.retry?.backoffMs,
            defaults.indexing.retry.backoffMs,
          ),
        },
      },
      retrieval: {
        hybrid: {
          ftsTopN: normalizePositiveInt(
            next.retrieval?.hybrid?.ftsTopN,
            defaults.retrieval.hybrid.ftsTopN,
          ),
          vectorTopK: normalizePositiveInt(
            next.retrieval?.hybrid?.vectorTopK,
            defaults.retrieval.hybrid.vectorTopK,
          ),
          rerankTopN: normalizePositiveInt(
            next.retrieval?.hybrid?.rerankTopN,
            defaults.retrieval.hybrid.rerankTopN,
          ),
        },
      },
      embedding,
      reranker,
    };
  }

  const legacy = input as { sources?: unknown };
  return {
    ...defaults,
    version: 1,
    sources: normalizeSources(Array.isArray(legacy.sources) ? legacy.sources : []),
  };
}

function mergeEmbedding(
  defaults: AppConfig["embedding"],
  legacy:
    | {
        provider?: AppConfig["embedding"]["provider"];
        endpoint?: string;
        apiKey?: string;
        apiKeys?: Record<string, string>;
        model?: string;
        dimension?: number;
        local?: Partial<LocalEmbeddingConfig>;
        qwen_dense?: Partial<CloudEmbeddingConfig>;
        qwen_sparse?: Partial<CloudEmbeddingConfig>;
        openai_dense?: Partial<CloudEmbeddingConfig>;
      }
    | undefined,
  legacyHfEndpoint?: string,
): AppConfig["embedding"] {
  const provider = legacy?.provider ?? defaults.provider;
  const normalizedApiKeys = normalizeLegacyApiKeys(
    legacy?.provider,
    legacy?.apiKey,
    legacy?.apiKeys,
  );

  return {
    provider,
    local: {
      ...defaults.local,
      ...(legacy?.local ?? {}),
      hfEndpoint:
        legacy?.local?.hfEndpoint ??
        legacyHfEndpoint ??
        defaults.local.hfEndpoint,
      model: legacy?.local?.model ?? legacy?.model ?? defaults.local.model,
      dimension:
        legacy?.local?.dimension ??
        legacy?.dimension ??
        defaults.local.dimension,
    },
    qwen_dense: {
      ...defaults.qwen_dense,
      ...(legacy?.qwen_dense ?? {}),
      apiKey:
        legacy?.qwen_dense?.apiKey ??
        normalizedApiKeys.qwen_dense ??
        defaults.qwen_dense.apiKey,
      model:
        legacy?.qwen_dense?.model ?? legacy?.model ?? defaults.qwen_dense.model,
      dimension:
        legacy?.qwen_dense?.dimension ??
        legacy?.dimension ??
        defaults.qwen_dense.dimension,
    },
    qwen_sparse: {
      ...defaults.qwen_sparse,
      ...(legacy?.qwen_sparse ?? {}),
      apiKey:
        legacy?.qwen_sparse?.apiKey ??
        normalizedApiKeys.qwen_sparse ??
        defaults.qwen_sparse.apiKey,
      model:
        legacy?.qwen_sparse?.model ??
        legacy?.model ??
        defaults.qwen_sparse.model,
      dimension:
        legacy?.qwen_sparse?.dimension ??
        legacy?.dimension ??
        defaults.qwen_sparse.dimension,
    },
    openai_dense: {
      ...defaults.openai_dense,
      ...(legacy?.openai_dense ?? {}),
      apiKey:
        legacy?.openai_dense?.apiKey ??
        normalizedApiKeys.openai_dense ??
        defaults.openai_dense.apiKey,
      model:
        legacy?.openai_dense?.model ??
        legacy?.model ??
        defaults.openai_dense.model,
      dimension:
        legacy?.openai_dense?.dimension ??
        legacy?.dimension ??
        defaults.openai_dense.dimension,
    },
  };
}

function mergeReranker(
  defaults: AppConfig["reranker"],
  legacy:
    | {
        enabled?: boolean;
        provider?: AppConfig["reranker"]["provider"];
        mode?: "none" | "local";
        model?: string;
        topN?: number;
        local?: Partial<LocalRerankerConfig>;
        qwen?: Partial<CloudRerankerConfig>;
        openai?: Partial<CloudRerankerConfig>;
      }
    | undefined,
  legacyHfEndpoint?: string,
): AppConfig["reranker"] {
  const provider =
    legacy?.provider ?? (legacy?.mode === "none" ? "local" : defaults.provider);
  return {
    enabled:
      legacy?.enabled ??
      (legacy?.mode ? legacy.mode !== "none" : defaults.enabled),
    provider,
    local: {
      ...defaults.local,
      ...(legacy?.local ?? {}),
      hfEndpoint:
        legacy?.local?.hfEndpoint ??
        legacyHfEndpoint ??
        defaults.local.hfEndpoint,
      model: legacy?.local?.model ?? legacy?.model ?? defaults.local.model,
      topN: legacy?.local?.topN ?? legacy?.topN ?? defaults.local.topN,
    },
    qwen: {
      ...defaults.qwen,
      ...(legacy?.qwen ?? {}),
      model: legacy?.qwen?.model ?? legacy?.model ?? defaults.qwen.model,
      topN: legacy?.qwen?.topN ?? legacy?.topN ?? defaults.qwen.topN,
    },
    openai: {
      ...defaults.openai,
      ...(legacy?.openai ?? {}),
      model: legacy?.openai?.model ?? legacy?.model ?? defaults.openai.model,
      topN: legacy?.openai?.topN ?? legacy?.topN ?? defaults.openai.topN,
    },
  };
}

function normalizeLegacyApiKeys(
  provider: string | undefined,
  apiKey: string | undefined,
  apiKeys: Record<string, string> | undefined,
) {
  const result: Record<string, string> = {};
  if (apiKeys) {
    for (const [key, value] of Object.entries(apiKeys)) {
      if (!value) {
        continue;
      }
      const normalized = key.includes(":") ? key.split(":")[0] : key;
      result[normalized] = value;
    }
  }
  if (provider && apiKey) {
    result[provider] = apiKey;
  }
  return result;
}

function normalizePort(port: unknown, fallback: number) {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    return fallback;
  }
  return value;
}

function normalizeSources(input: unknown[]): SourceConfig[] {
  const normalized = input
    .map((item) => {
      if (typeof item === "string") {
        return { path: item, enabled: true };
      }
      const source = item as Partial<SourceConfig>;
      if (typeof source.path === "string") {
        return { path: source.path, enabled: source.enabled ?? true };
      }
      return null;
    })
    .filter((item): item is SourceConfig => item !== null)
    .map((item) => ({
      path: normalizeSourcePath(item.path),
      enabled: item.enabled,
    }))
    .filter((item) => item.path.length > 0);

  return dedupeAndCollapseSources(normalized);
}

function normalizeSourcePath(path: string) {
  const trimmed = path.trim();
  if (trimmed === "/") {
    return trimmed;
  }
  return trimmed.replace(/\/+$/, "");
}

function dedupeAndCollapseSources(sources: SourceConfig[]): SourceConfig[] {
  const mergedByPath = new Map<string, SourceConfig>();
  for (const source of sources) {
    const existing = mergedByPath.get(source.path);
    if (!existing) {
      mergedByPath.set(source.path, { ...source });
      continue;
    }
    mergedByPath.set(source.path, {
      path: source.path,
      enabled: existing.enabled || source.enabled,
    });
  }

  const collapsed: SourceConfig[] = [];
  for (const candidate of mergedByPath.values()) {
    const hasParent = collapsed.some((parent) => isSameOrParentPath(parent.path, candidate.path));
    if (hasParent) {
      continue;
    }
    for (let i = collapsed.length - 1; i >= 0; i -= 1) {
      if (isSameOrParentPath(candidate.path, collapsed[i]!.path)) {
        collapsed.splice(i, 1);
      }
    }
    collapsed.push(candidate);
  }
  return collapsed;
}

function isSameOrParentPath(parent: string, child: string) {
  if (parent === child) {
    return true;
  }
  const prefix = `${parent}/`;
  return child.startsWith(prefix);
}

export function createConfigService(opts?: {
  configPath?: string;
  userDataDir?: string;
}): ConfigService {
  const defaults = getDefaultConfigWithPaths({
    userDataDir: opts?.userDataDir,
  });
  const configPath =
    opts?.configPath ??
    (opts?.userDataDir
      ? join(opts.userDataDir, "app-config.json")
      : "build/app-config.json");
  let cache: AppConfig | null = null;
  const emitter = new EventEmitter();
  const CONFIG_CHANGED_EVENT = "config_changed";

  function persist(config: AppConfig) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  }

  function load(): AppConfig {
    try {
      const raw = readFileSync(configPath, "utf8");
      const parsed = migrateConfigWithDefaults(JSON.parse(raw), defaults);
      const validation = validateConfig(parsed);
      if (!validation.ok) {
        const fallback = defaults;
        persist(fallback);
        return fallback;
      }
      const normalized = JSON.stringify(parsed, null, 2) + "\n";
      if (raw !== normalized) {
        persist(parsed);
      }
      return parsed;
    } catch {
      const fallback = defaults;
      persist(fallback);
      return fallback;
    }
  }

  return {
    getConfig() {
      if (!cache) {
        cache = load();
      }
      return cache;
    },
    updateConfig(updater) {
      const current = this.getConfig();
      const next = updater(current);
      cache = next;
      persist(next);
      const event: ConfigChangeEvent = { prev: current, next };
      emitter.emit(CONFIG_CHANGED_EVENT, event);
      return next;
    },
    subscribe(listener) {
      emitter.on(CONFIG_CHANGED_EVENT, listener);
      return () => {
        emitter.off(CONFIG_CHANGED_EVENT, listener);
      };
    },
  };
}

export const defaultConfigService = createConfigService();
