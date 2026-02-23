import type { AppConfig, ConfigService } from "../../core/config/config.types";
import { createDefaultConfig } from "../../core/config/default-config";
import { getConfigFromBun, updateConfigInBun } from "./bun.rpc";

const STORAGE_KEY = "knowdisk-app-config";
const listeners = new Set<
  (event: { prev: AppConfig; next: AppConfig }) => void
>();

function getDefaultConfig(): AppConfig {
  return createDefaultConfig({
    embeddingCacheDir: "models/embedding/local",
    rerankerCacheDir: "models/reranker/local",
  });
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
        completed:
          parsed.onboarding?.completed ?? defaults.onboarding.completed,
      },
      sources: dedupeAndCollapseSources(
        normalizedSources
          .map((item) => ({
            path: normalizeSourcePath(item.path),
            enabled: item.enabled,
          }))
          .filter((item) => item.path.length > 0),
      ),
      mcp: {
        enabled: parsed.mcp?.enabled ?? true,
        port:
          Number.isInteger(parsed.mcp?.port) &&
          (parsed.mcp?.port ?? 0) > 0 &&
          (parsed.mcp?.port ?? 0) <= 65535
            ? (parsed.mcp?.port as number)
            : defaults.mcp.port,
      },
      indexing: {
        chunking: {
          sizeChars:
            Number.isInteger(parsed.indexing?.chunking?.sizeChars) &&
            (parsed.indexing?.chunking?.sizeChars ?? 0) > 0
              ? (parsed.indexing?.chunking?.sizeChars as number)
              : defaults.indexing.chunking.sizeChars,
          overlapChars:
            Number.isInteger(parsed.indexing?.chunking?.overlapChars) &&
            (parsed.indexing?.chunking?.overlapChars ?? 0) > 0
              ? (parsed.indexing?.chunking?.overlapChars as number)
              : defaults.indexing.chunking.overlapChars,
          charsPerToken:
            Number.isInteger(parsed.indexing?.chunking?.charsPerToken) &&
            (parsed.indexing?.chunking?.charsPerToken ?? 0) > 0
              ? (parsed.indexing?.chunking?.charsPerToken as number)
              : defaults.indexing.chunking.charsPerToken,
        },
        watch: {
          enabled:
            parsed.indexing?.watch?.enabled ?? defaults.indexing.watch.enabled,
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
          cacheDir: normalizeLegacyModelCacheDir(
            parsed.embedding?.local?.cacheDir,
            "embedding",
            defaults.embedding.local.cacheDir,
          ),
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
          cacheDir: normalizeLegacyModelCacheDir(
            parsed.reranker?.local?.cacheDir,
            "reranker",
            defaults.reranker.local.cacheDir,
          ),
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

function normalizeSourcePath(path: string) {
  const trimmed = path.trim();
  if (trimmed === "/") {
    return trimmed;
  }
  return trimmed.replace(/\/+$/, "");
}

function dedupeAndCollapseSources(
  sources: Array<{ path: string; enabled: boolean }>,
) {
  const mergedByPath = new Map<string, { path: string; enabled: boolean }>();
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

  const collapsed: Array<{ path: string; enabled: boolean }> = [];
  for (const candidate of mergedByPath.values()) {
    const hasParent = collapsed.some((parent) =>
      isSameOrParentPath(parent.path, candidate.path),
    );
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
  return child.startsWith(`${parent}/`);
}

function normalizeLegacyModelCacheDir(
  cacheDir: string | undefined,
  kind: "embedding" | "reranker",
  fallback: string,
) {
  if (!cacheDir || cacheDir.trim().length === 0) {
    return fallback;
  }
  if (cacheDir === `cache/${kind}/local`) {
    return `models/${kind}/local`;
  }
  return cacheDir;
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
    for (const listener of listeners) {
      listener({ prev: current, next });
    }
    return next;
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
