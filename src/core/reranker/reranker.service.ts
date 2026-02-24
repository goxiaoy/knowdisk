import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config/config.types";
import type { RerankRow, RerankerService } from "./reranker.types";

export function createReranker(
  config: AppConfig["reranker"],
  opts?: {
    ensureLocalModelReady?: () => Promise<void>;
  },
): RerankerService | null {
  if (!config.enabled) {
    return null;
  }

  const topN = getTopN(config);
  const localRuntimePromise = config.provider === "local"
    ? (async () => {
      await opts?.ensureLocalModelReady?.();
      return initLocalRerankerRuntime(config);
    })()
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

type LocalRerankerRuntime = {
  tokenizePairs: (query: string, docs: string[]) => Promise<unknown>;
  score: (inputs: unknown) => Promise<number[]>;
};

async function initLocalRerankerRuntime(
  config: AppConfig["reranker"],
): Promise<LocalRerankerRuntime> {
  const providerDir = join(config.local.cacheDir, "provider-local");
  mkdirSync(providerDir, { recursive: true });

  const transformers = await import("@huggingface/transformers");
  const env = (transformers as unknown as {
    env?: {
      allowRemoteModels?: boolean;
      remoteHost?: string;
      cacheDir?: string;
    };
  }).env;

  if (env) {
    env.allowRemoteModels = true;
    env.remoteHost = config.local.hfEndpoint.replace(/\/+$/, "") + "/";
    env.cacheDir = providerDir;
  }

  const loadRuntime = async () => {
    const tokenizer = await (
      transformers as unknown as {
        AutoTokenizer: {
          from_pretrained: (model: string) => Promise<{
            (
              texts: string[],
              opts: {
                text_pair: string[];
                padding: boolean;
                truncation: boolean;
              },
            ): unknown;
          }>;
        };
      }
    ).AutoTokenizer.from_pretrained(config.local.model);

    const model = await (
      transformers as unknown as {
        AutoModelForSequenceClassification: {
          from_pretrained: (model: string, opts: { quantized: boolean }) => Promise<{
            (inputs: unknown): Promise<{ logits?: { data?: ArrayLike<number> } }>;
          }>;
        };
      }
    ).AutoModelForSequenceClassification.from_pretrained(config.local.model, {
      quantized: false,
    });
    return { tokenizer, model };
  };

  let runtime: Awaited<ReturnType<typeof loadRuntime>>;
  try {
    runtime = await loadRuntime();
  } catch (error) {
    if (!isCorruptedModelError(error)) {
      throw error;
    }
    rmSync(join(providerDir, config.local.model), {
      recursive: true,
      force: true,
    });
    runtime = await loadRuntime();
  }

  return {
    async tokenizePairs(query: string, docs: string[]) {
      const queries = Array(docs.length).fill(query);
      return runtime.tokenizer(queries, {
        text_pair: docs,
        padding: true,
        truncation: true,
      });
    },
    async score(inputs: unknown) {
      const outputs = await runtime.model(inputs);
      if (!outputs?.logits?.data) {
        return [];
      }
      return Array.from(outputs.logits.data);
    },
  };
}

function isCorruptedModelError(error: unknown) {
  const message = String(error ?? "").toLowerCase();
  return (
    message.includes("protobuf parsing failed") ||
    message.includes("could not locate file") ||
    message.includes("unexpected end of json input")
  );
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
