import type { AppConfig } from "./config.types";

export function createDefaultConfig(opts?: {
  modelCacheDir?: string;
  modelHfEndpoint?: string;
}): AppConfig {
  const modelCacheDir = opts?.modelCacheDir ?? "build/models";
  const modelHfEndpoint = opts?.modelHfEndpoint ?? "https://hf-mirror.com";

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
      chunking: { sizeChars: 1200, overlapChars: 200, charsPerToken: 4 },
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
    model: {
      hfEndpoint: modelHfEndpoint,
      cacheDir: modelCacheDir,
    },
    embedding: {
      provider: "local",
      local: {
        model: "onnx-community/gte-multilingual-base",
        dimension: 768,
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
        model: "Xenova/bge-reranker-base",
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
    chat: {
      provider: "openai",
      openai: {
        apiKey: "",
        model: "",
        domain: "https://api.openai.com",
      },
    },
  };
}
