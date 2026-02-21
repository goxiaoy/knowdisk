import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AppConfig, ConfigService, SourceConfig } from "./config.types";
import { isCloudEmbeddingProvider } from "../embedding/embedding.types";

export function getDefaultConfig(): AppConfig {
  return {
    version: 1,
    sources: [],
    mcp: {
      enabled: true,
    },
    ui: { mode: "safe" },
    indexing: { watch: { enabled: true } },
    embedding: {
      provider: "local",
      endpoint: "",
      apiKeys: {},
      dimension: 384,
    },
    modelHub: {
      hfEndpoint: "https://hf-mirror.com",
    },
    reranker: {
      mode: "local",
      model: "BAAI/bge-reranker-base",
      topN: 5,
    },
  };
}

export function validateConfig(cfg: AppConfig): { ok: boolean; errors: string[] } {
  if (isCloudEmbeddingProvider(cfg.embedding.provider) && !cfg.embedding.endpoint) {
    return { ok: false, errors: ["embedding.endpoint is required for cloud providers"] };
  }
  const activeApiKey = cfg.embedding.apiKeys[cfg.embedding.provider] ?? "";
  if (isCloudEmbeddingProvider(cfg.embedding.provider) && !activeApiKey) {
    return { ok: false, errors: ["embedding.apiKeys is missing active provider key"] };
  }
  if (cfg.embedding.dimension <= 0) {
    return { ok: false, errors: ["embedding.dimension must be > 0"] };
  }
  if (!cfg.modelHub.hfEndpoint) {
    return { ok: false, errors: ["modelHub.hfEndpoint is required"] };
  }
  if (cfg.reranker.topN <= 0) {
    return { ok: false, errors: ["reranker.topN must be > 0"] };
  }
  return { ok: true, errors: [] };
}

export function migrateConfig(input: unknown): AppConfig {
  const version = (input as { version?: number })?.version ?? 0;
  if (version === 1) {
    const next = input as Partial<AppConfig>;
    const legacyApiKeys = normalizeEmbeddingApiKeys(next.embedding);
    const migratedSources =
      Array.isArray(next.sources) && next.sources.length > 0
        ? normalizeSources(next.sources as unknown[])
        : [];
    return {
      ...getDefaultConfig(),
      ...next,
      sources: migratedSources,
      mcp: {
        enabled: next.mcp?.enabled ?? true,
      },
      embedding: {
        ...getDefaultConfig().embedding,
        ...(next.embedding ?? {}),
        apiKeys: {
          ...getDefaultConfig().embedding.apiKeys,
          ...legacyApiKeys,
          ...((next.embedding as Partial<AppConfig["embedding"]> | undefined)?.apiKeys ?? {}),
        },
      },
      modelHub: {
        ...getDefaultConfig().modelHub,
        ...(next.modelHub ?? {}),
      },
      reranker: {
        ...getDefaultConfig().reranker,
        ...(next.reranker ?? {}),
      },
    };
  }

  const legacy = input as { sources?: unknown };
  return {
    ...getDefaultConfig(),
    version: 1,
    sources: normalizeSources(Array.isArray(legacy.sources) ? legacy.sources : []),
  };
}

function normalizeEmbeddingApiKeys(embedding: unknown): Record<string, string> {
  const current = embedding as
    | {
        provider?: string;
        apiKey?: string;
        apiKeys?: Record<string, string>;
      }
    | undefined;
  const result: Record<string, string> = {};
  if (!current) {
    return result;
  }
  if (current.apiKeys) {
    for (const [key, value] of Object.entries(current.apiKeys)) {
      if (!value) {
        continue;
      }
      const provider = key.includes(":") ? key.split(":")[0] : key;
      result[provider] = value;
    }
  }
  if (current.apiKey && current.provider) {
    result[current.provider] = current.apiKey;
  }
  return result;
}

function normalizeSources(input: unknown[]): SourceConfig[] {
  return input
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
    .filter((item): item is SourceConfig => item !== null);
}

export function createConfigService(opts?: { configPath?: string }): ConfigService {
  const configPath = opts?.configPath ?? "build/app-config.json";
  let cache: AppConfig | null = null;

  function persist(config: AppConfig) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  }

  function load(): AppConfig {
    try {
      const raw = readFileSync(configPath, "utf8");
      const parsed = migrateConfig(JSON.parse(raw));
      const validation = validateConfig(parsed);
      if (!validation.ok) {
        const fallback = getDefaultConfig();
        persist(fallback);
        return fallback;
      }
      return parsed;
    } catch {
      const fallback = getDefaultConfig();
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
    getMcpEnabled() {
      cache = load();
      return cache.mcp.enabled;
    },
    setMcpEnabled(enabled: boolean) {
      const next = { ...this.getConfig(), mcp: { enabled } };
      cache = next;
      persist(next);
      return next;
    },
    getSources() {
      return this.getConfig().sources;
    },
    addSource(path: string) {
      const current = this.getConfig();
      if (current.sources.some((item) => item.path === path)) {
        return current.sources;
      }
      const sources = [...current.sources, { path, enabled: true }];
      const next = { ...current, sources };
      cache = next;
      persist(next);
      return sources;
    },
    updateSource(path: string, enabled: boolean) {
      const current = this.getConfig();
      const sources = current.sources.map((item) =>
        item.path === path ? { ...item, enabled } : item,
      );
      const next = { ...current, sources };
      cache = next;
      persist(next);
      return sources;
    },
    removeSource(path: string) {
      const current = this.getConfig();
      const sources = current.sources.filter((item) => item.path !== path);
      const next = { ...current, sources };
      cache = next;
      persist(next);
      return sources;
    },
    updateEmbedding(input) {
      const current = this.getConfig();
      const next = {
        ...current,
        embedding: {
          ...current.embedding,
          ...input,
          apiKeys: {
            ...current.embedding.apiKeys,
            ...(input.apiKeys ?? {}),
          },
        },
      };
      cache = next;
      persist(next);
      return next;
    },
    updateModelHub(input) {
      const current = this.getConfig();
      const next = { ...current, modelHub: { ...current.modelHub, ...input } };
      cache = next;
      persist(next);
      return next;
    },
    updateReranker(input) {
      const current = this.getConfig();
      const next = { ...current, reranker: { ...current.reranker, ...input } };
      cache = next;
      persist(next);
      return next;
    },
  };
}

export const defaultConfigService = createConfigService();
