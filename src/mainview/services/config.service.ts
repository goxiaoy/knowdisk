import type { AppConfig, ConfigService } from "../../core/config/config.types";
import {
  getConfigFromBun,
  updateConfigInBun,
} from "./bun.rpc";

const STORAGE_KEY = "knowdisk-app-config";

function getDefaultConfig(): AppConfig {
  return {
    version: 1,
    onboarding: {
      completed: false,
    },
    sources: [],
    mcp: { enabled: true, port: 3467 },
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
      onboarding: {
        completed: parsed.onboarding?.completed ?? defaults.onboarding.completed,
      },
      sources: normalizedSources.filter((item) => item.path.length > 0),
      mcp: {
        enabled: parsed.mcp?.enabled ?? true,
        port:
          Number.isInteger(parsed.mcp?.port) && (parsed.mcp?.port ?? 0) > 0 && (parsed.mcp?.port ?? 0) <= 65535
            ? (parsed.mcp?.port as number)
            : defaults.mcp.port,
      },
      indexing: {
        watch: {
          enabled: parsed.indexing?.watch?.enabled ?? defaults.indexing.watch.enabled,
          debounceMs:
            Number.isInteger(parsed.indexing?.watch?.debounceMs) &&
            (parsed.indexing?.watch?.debounceMs ?? 0) > 0
              ? (parsed.indexing?.watch?.debounceMs as number)
              : defaults.indexing.watch.debounceMs,
        },
        reconcile: {
          enabled:
            parsed.indexing?.reconcile?.enabled ??
            defaults.indexing.reconcile.enabled,
          intervalMs:
            Number.isInteger(parsed.indexing?.reconcile?.intervalMs) &&
            (parsed.indexing?.reconcile?.intervalMs ?? 0) > 0
              ? (parsed.indexing?.reconcile?.intervalMs as number)
              : defaults.indexing.reconcile.intervalMs,
        },
        worker: {
          concurrency:
            Number.isInteger(parsed.indexing?.worker?.concurrency) &&
            (parsed.indexing?.worker?.concurrency ?? 0) > 0
              ? (parsed.indexing?.worker?.concurrency as number)
              : defaults.indexing.worker.concurrency,
          batchSize:
            Number.isInteger(parsed.indexing?.worker?.batchSize) &&
            (parsed.indexing?.worker?.batchSize ?? 0) > 0
              ? (parsed.indexing?.worker?.batchSize as number)
              : defaults.indexing.worker.batchSize,
        },
        retry: {
          maxAttempts:
            Number.isInteger(parsed.indexing?.retry?.maxAttempts) &&
            (parsed.indexing?.retry?.maxAttempts ?? 0) > 0
              ? (parsed.indexing?.retry?.maxAttempts as number)
              : defaults.indexing.retry.maxAttempts,
          backoffMs:
            Array.isArray(parsed.indexing?.retry?.backoffMs) &&
            parsed.indexing.retry.backoffMs.length > 0
              ? parsed.indexing.retry.backoffMs
                  .map((item) => Number(item))
                  .filter((item) => Number.isFinite(item) && item > 0)
                  .map((item) => Math.floor(item))
              : defaults.indexing.retry.backoffMs,
        },
      },
      retrieval: {
        hybrid: {
          ftsTopN:
            Number.isInteger(parsed.retrieval?.hybrid?.ftsTopN) &&
            (parsed.retrieval?.hybrid?.ftsTopN ?? 0) > 0
              ? (parsed.retrieval?.hybrid?.ftsTopN as number)
              : defaults.retrieval.hybrid.ftsTopN,
          vectorTopK:
            Number.isInteger(parsed.retrieval?.hybrid?.vectorTopK) &&
            (parsed.retrieval?.hybrid?.vectorTopK ?? 0) > 0
              ? (parsed.retrieval?.hybrid?.vectorTopK as number)
              : defaults.retrieval.hybrid.vectorTopK,
          rerankTopN:
            Number.isInteger(parsed.retrieval?.hybrid?.rerankTopN) &&
            (parsed.retrieval?.hybrid?.rerankTopN ?? 0) > 0
              ? (parsed.retrieval?.hybrid?.rerankTopN as number)
              : defaults.retrieval.hybrid.rerankTopN,
        },
      },
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
