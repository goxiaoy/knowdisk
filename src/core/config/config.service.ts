import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AppConfig, ConfigService, SourceConfig } from "./config.types";

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
      mode: "local",
      model: "BAAI/bge-small-en-v1.5",
      endpoint: "",
      dimension: 384,
    },
    reranker: {
      mode: "local",
      model: "BAAI/bge-reranker-base",
      topN: 5,
    },
  };
}

export function validateConfig(cfg: AppConfig): { ok: boolean; errors: string[] } {
  if (cfg.embedding.mode === "cloud" && !cfg.embedding.endpoint) {
    return { ok: false, errors: ["embedding.endpoint is required for cloud mode"] };
  }
  if (cfg.embedding.dimension <= 0) {
    return { ok: false, errors: ["embedding.dimension must be > 0"] };
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
      const next = { ...current, embedding: { ...current.embedding, ...input } };
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
