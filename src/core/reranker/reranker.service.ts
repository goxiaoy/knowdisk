import type { AppConfig } from "../config/config.types";
import type {
  LocalRerankerRuntime,
  ModelDownloadService,
} from "../model/model-download.service.types";
import type { RerankRow, RerankerService } from "./reranker.types";

export function createReranker(
  config: AppConfig["reranker"],
  modelDownloadService?: ModelDownloadService,
): RerankerService | null {
  if (!config.enabled) {
    return null;
  }

  const topN = getTopN(config);
  const localRuntimePromise =
    config.provider === "local"
      ? modelDownloadService?.getLocalRerankerRuntime() ?? null
      : null;
  void localRuntimePromise?.catch(() => {});

  return {
    async rerank(query: string, rows: RerankRow[], opts: { topK: number }) {
      const rescored = config.provider === "local"
        ? await rerankWithLocalModel(query, rows, localRuntimePromise)
        : rerankWithTokenOverlap(query, rows);
      rescored.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
      return rescored.slice(0, Math.min(opts.topK, topN));
    },
  };
}

function getTopN(config: AppConfig["reranker"]) {
  if (config.provider === "local") return config.local.topN;
  if (config.provider === "qwen") return config.qwen.topN;
  return config.openai.topN;
}

async function rerankWithLocalModel(
  query: string,
  rows: RerankRow[],
  runtimePromise: Promise<LocalRerankerRuntime> | null,
) {
  if (!runtimePromise || rows.length === 0) {
    return rows;
  }
  const docs = rows.map((row) => row.metadata.chunkText ?? "");
  try {
    const runtime = await runtimePromise;
    const inputs = await runtime.tokenizePairs(query, docs);
    const scores = await runtime.score(inputs);
    if (scores.length !== rows.length) {
      return rerankWithTokenOverlap(query, rows);
    }
    return rows.map((row, idx) => ({
      ...row,
      score: scores[idx] ?? row.score,
    }));
  } catch {
    return rerankWithTokenOverlap(query, rows);
  }
}

function rerankWithTokenOverlap(query: string, rows: RerankRow[]) {
  const queryTerms = tokenize(query);
  return rows.map((row) => {
    const overlap = countOverlap(queryTerms, tokenize(row.metadata.chunkText ?? ""));
    const blend = row.score * 0.75 + overlap * 0.25;
    return { ...row, score: blend };
  });
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((item) => item.length > 1);
}

function countOverlap(a: string[], b: string[]): number {
  const set = new Set(a);
  let count = 0;
  for (const token of b) {
    if (set.has(token)) {
      count += 1;
    }
  }
  return count;
}
