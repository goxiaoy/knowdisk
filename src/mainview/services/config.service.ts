import type { AppConfig, ConfigService } from "../../core/config/config.types";
import {
  addSourceInBun,
  getConfigFromBun,
  removeSourceInBun,
  setEmbeddingConfigInBun,
  setMcpEnabledInBun,
  setRerankerConfigInBun,
  updateSourceInBun,
} from "./bun.rpc";

const STORAGE_KEY = "knowdisk-app-config";

function getDefaultConfig(): AppConfig {
  return {
    version: 1,
    sources: [],
    mcp: { enabled: true },
    ui: { mode: "safe" },
    indexing: { watch: { enabled: true } },
    embedding: { mode: "local", model: "BAAI/bge-small-en-v1.5", endpoint: "", dimension: 384 },
    reranker: { mode: "local", model: "BAAI/bge-reranker-base", topN: 5 },
  };
}

function loadConfig(): AppConfig {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return getDefaultConfig();
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const normalizedSources = Array.isArray(parsed.sources)
      ? parsed.sources.map((item) =>
          typeof item === "string"
            ? { path: item, enabled: true }
            : { path: String(item.path ?? ""), enabled: item.enabled ?? true },
        )
      : [];

    return {
      ...getDefaultConfig(),
      ...parsed,
      sources: normalizedSources.filter((item) => item.path.length > 0),
      mcp: { enabled: parsed.mcp?.enabled ?? true },
      embedding: {
        ...getDefaultConfig().embedding,
        ...(parsed.embedding ?? {}),
      },
      reranker: {
        ...getDefaultConfig().reranker,
        ...(parsed.reranker ?? {}),
      },
    };
  } catch {
    return getDefaultConfig();
  }
}

function saveConfig(cfg: AppConfig) {
  globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export async function hydrateConfigFromBun() {
  const config = await getConfigFromBun();
  if (config) {
    saveConfig(config);
  }
}

export const defaultMainviewConfigService: ConfigService = {
  getConfig() {
    return loadConfig();
  },
  getMcpEnabled() {
    return loadConfig().mcp.enabled;
  },
  setMcpEnabled(enabled: boolean) {
    const next = { ...loadConfig(), mcp: { enabled } };
    saveConfig(next);
    void setMcpEnabledInBun(enabled);
    return next;
  },
  getSources() {
    return loadConfig().sources;
  },
  addSource(path: string) {
    const current = loadConfig();
    if (current.sources.some((item) => item.path === path)) {
      return current.sources;
    }
    const sources = [...current.sources, { path, enabled: true }];
    saveConfig({ ...current, sources });
    void addSourceInBun(path);
    return sources;
  },
  updateSource(path: string, enabled: boolean) {
    const current = loadConfig();
    const sources = current.sources.map((item) =>
      item.path === path ? { ...item, enabled } : item,
    );
    saveConfig({ ...current, sources });
    void updateSourceInBun(path, enabled);
    return sources;
  },
  removeSource(path: string) {
    const current = loadConfig();
    const sources = current.sources.filter((item) => item.path !== path);
    saveConfig({ ...current, sources });
    void removeSourceInBun(path);
    return sources;
  },
  updateEmbedding(input) {
    const current = loadConfig();
    const next = { ...current, embedding: { ...current.embedding, ...input } };
    saveConfig(next);
    void setEmbeddingConfigInBun(input);
    return next;
  },
  updateReranker(input) {
    const current = loadConfig();
    const next = { ...current, reranker: { ...current.reranker, ...input } };
    saveConfig(next);
    void setRerankerConfigInBun(input);
    return next;
  },
};
