import {
  getEmbeddingProviderModel,
  isCloudEmbeddingProvider,
  type EmbeddingConfig,
  type EmbeddingProvider,
} from "./embedding.types";

type EmbeddingDeps = {
  fetchImpl?: typeof fetch;
};

export function makeEmbeddingProvider(cfg: EmbeddingConfig, deps?: EmbeddingDeps): EmbeddingProvider {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  return {
    async embed(text: string) {
      if (isCloudEmbeddingProvider(cfg.provider)) {
        return embedCloud(cfg, text, fetchImpl);
      }
      const dims = Math.max(1, cfg.dimension);
      const seed = hash(`${cfg.provider}:${cfg.endpoint ?? ""}:${text}`);
      const vector = new Array<number>(dims);
      for (let i = 0; i < dims; i += 1) {
        const value = Math.sin(seed * (i + 1)) + Math.cos((seed + i) * 0.37);
        vector[i] = value;
      }
      return normalize(vector);
    },
  };
}

async function embedCloud(cfg: EmbeddingConfig, text: string, fetchImpl: typeof fetch) {
  const apiKey = cfg.apiKeys?.[cfg.provider] ?? "";
  if (!cfg.endpoint || !apiKey) {
    throw new Error("cloud embedding requires endpoint and apiKeys entry");
  }
  const model = getEmbeddingProviderModel(cfg.provider);

  const response = await fetchImpl(cfg.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(cfg.provider === "qwen_dense" || cfg.provider === "qwen_sparse"
        ? { "X-DashScope-SSE": "disable" }
        : {}),
    },
    body: JSON.stringify({
      model,
      input: text,
      text: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`embedding request failed: ${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const vector = extractDenseVector(payload, cfg.dimension);
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

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) + 1;
}

function normalize(input: number[]): number[] {
  let sum = 0;
  for (const value of input) {
    sum += value * value;
  }
  const norm = Math.sqrt(sum) || 1;
  return input.map((value) => value / norm);
}
