import type { AppConfig, ConfigService } from "../../core/config/config.types";
import {
  getConfigFromBun,
  updateConfigInBun,
} from "./bun.rpc";

const STORAGE_KEY = "knowdisk-app-config";

function getDefaultConfig(): AppConfig {
  return {
    version: 1,
    sources: [],
    mcp: { enabled: true },
    ui: { mode: "safe" },
    indexing: { watch: { enabled: true } },
    embedding: {
      provider: "local",
      local: {
        hfEndpoint: "https://hf-mirror.com",
        cacheDir: "cache/embedding/local",
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
        cacheDir: "cache/reranker/local",
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

    const defaults = getDefaultConfig();
    return {
      ...defaults,
      ...parsed,
      sources: normalizedSources.filter((item) => item.path.length > 0),
      mcp: { enabled: parsed.mcp?.enabled ?? true },
      embedding: {
        ...defaults.embedding,
        ...(parsed.embedding ?? {}),
        local: {
          ...defaults.embedding.local,
          ...(parsed.embedding?.local ?? {}),
        },
        qwen_dense: {
          ...defaults.embedding.qwen_dense,
          ...(parsed.embedding?.qwen_dense ?? {}),
        },
        qwen_sparse: {
          ...defaults.embedding.qwen_sparse,
          ...(parsed.embedding?.qwen_sparse ?? {}),
        },
        openai_dense: {
          ...defaults.embedding.openai_dense,
          ...(parsed.embedding?.openai_dense ?? {}),
        },
      },
      reranker: {
        ...defaults.reranker,
        ...(parsed.reranker ?? {}),
        local: {
          ...defaults.reranker.local,
          ...(parsed.reranker?.local ?? {}),
        },
        qwen: {
          ...defaults.reranker.qwen,
          ...(parsed.reranker?.qwen ?? {}),
        },
        openai: {
          ...defaults.reranker.openai,
          ...(parsed.reranker?.openai ?? {}),
        },
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
  updateConfig(updater) {
    const current = loadConfig();
    const next = updater(current);
    saveConfig(next);
    void updateConfigInBun(next);
    return next;
  },
};
