import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config/config.types";
import type { RerankRow, RerankerService } from "./reranker.types";

export function createReranker(config: AppConfig["reranker"]): RerankerService | null {
  if (!config.enabled) {
    return null;
  }

  const topN = getTopN(config);
  const providerDir = getProviderDir(config);
  mkdirSync(providerDir, { recursive: true });

  return {
    async rerank(query: string, rows: RerankRow[], opts: { topK: number }) {
      const queryTerms = tokenize(query);
      const rescored = rows.map((row) => {
        const overlap = countOverlap(queryTerms, tokenize(row.metadata.chunkText ?? ""));
        const blend = row.score * 0.75 + overlap * 0.25;
        return { ...row, score: blend };
      });

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

function getProviderDir(config: AppConfig["reranker"]) {
  if (config.provider === "local") {
    return join(config.local.cacheDir, "provider-local");
  }
  return join("build", "cache", "reranker", config.provider);
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
