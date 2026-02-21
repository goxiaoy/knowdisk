import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isCloudEmbeddingProvider, type EmbeddingConfig } from "../embedding.types";

const EMBEDDING_ENDPOINTS = {
  openai_dense: "https://api.openai.com/v1/embeddings",
  qwen_dense: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/embeddings",
  qwen_sparse: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/embeddings",
} as const;

export async function embedWithCloudProvider(
  cfg: EmbeddingConfig,
  text: string,
  fetchImpl: typeof fetch,
): Promise<number[]> {
  if (!isCloudEmbeddingProvider(cfg.provider)) {
    throw new Error("embedWithCloudProvider called with local provider");
  }
  const providerCfg = cfg[cfg.provider];
  const apiKey = providerCfg.apiKey;
  if (!apiKey) {
    throw new Error(`cloud embedding requires apiKey for provider ${cfg.provider}`);
  }

  const providerDir = join("build", "cache", "embedding", cfg.provider);
  mkdirSync(providerDir, { recursive: true });

  const response = await fetchImpl(EMBEDDING_ENDPOINTS[cfg.provider], {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(cfg.provider === "qwen_dense" || cfg.provider === "qwen_sparse"
        ? { "X-DashScope-SSE": "disable" }
        : {}),
    },
    body: JSON.stringify({
      model: providerCfg.model,
      input: text,
      text,
    }),
  });

  if (!response.ok) {
    throw new Error(`embedding request failed: ${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const vector = extractDenseVector(payload, providerCfg.dimension);
  if (!vector) {
    throw new Error("embedding response missing vector");
  }
  return vector;
}

function extractDenseVector(payload: Record<string, unknown>, dims: number): number[] | null {
  const data = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.output) ? payload.output : null;
  if (!data || data.length === 0) {
    return null;
  }

  const first = (data[0] as Record<string, unknown>) ?? {};
  const embedding = first.embedding ?? first.text_embedding ?? first.sparse_embedding;

  if (Array.isArray(embedding)) {
    return embedding.map((item) => Number(item));
  }
  if (embedding && typeof embedding === "object") {
    const dense = new Array<number>(Math.max(1, dims)).fill(0);
    for (const [index, value] of Object.entries(embedding as Record<string, unknown>)) {
      const i = Number(index);
      if (Number.isFinite(i) && i >= 0 && i < dense.length) {
        dense[i] = Number(value);
      }
    }
    return dense;
  }
  return null;
}
