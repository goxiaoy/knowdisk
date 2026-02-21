import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  isCloudEmbeddingProvider,
  type EmbeddingConfig,
  type EmbeddingProvider,
} from "./embedding.types";

type EmbeddingDeps = {
  fetchImpl?: typeof fetch;
  createExtractor?: (
    model: string,
    opts: { hfEndpoint: string; cacheDir: string },
  ) => Promise<(text: string, opts: { pooling: "mean"; normalize: true }) => Promise<unknown>>;
};

const EMBEDDING_ENDPOINTS = {
  openai_dense: "https://api.openai.com/v1/embeddings",
  qwen_dense: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/embeddings",
  qwen_sparse: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/embeddings",
} as const;

export function makeEmbeddingProvider(cfg: EmbeddingConfig, deps?: EmbeddingDeps): EmbeddingProvider {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const createExtractor = deps?.createExtractor ?? createDefaultExtractor;

  return {
    async embed(text: string) {
      if (isCloudEmbeddingProvider(cfg.provider)) {
        return embedCloud(cfg, text, fetchImpl);
      }
      const extractor = await getLocalExtractor(cfg, createExtractor);
      const output = (await extractor(text, {
        pooling: "mean",
        normalize: true,
      })) as { data?: ArrayLike<number> };
      if (!output?.data) {
        throw new Error("local embedding output missing data");
      }
      return Array.from(output.data);
    },
  };
}

async function embedCloud(cfg: EmbeddingConfig, text: string, fetchImpl: typeof fetch) {
  if (!isCloudEmbeddingProvider(cfg.provider)) {
    throw new Error("embedCloud called with local provider");
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

const localExtractorCache = new Map<
  string,
  Promise<(text: string, opts: { pooling: "mean"; normalize: true }) => Promise<unknown>>
>();

async function getLocalExtractor(
  cfg: EmbeddingConfig,
  createExtractor: (
    model: string,
    opts: { hfEndpoint: string; cacheDir: string },
  ) => Promise<(text: string, opts: { pooling: "mean"; normalize: true }) => Promise<unknown>>,
) {
  const providerDir = join(cfg.local.cacheDir, "provider-local");
  mkdirSync(providerDir, { recursive: true });
  const key = `${cfg.local.model}|${cfg.local.hfEndpoint}|${providerDir}`;
  let extractor = localExtractorCache.get(key);
  if (!extractor) {
    extractor = createExtractor(cfg.local.model, {
      hfEndpoint: cfg.local.hfEndpoint,
      cacheDir: providerDir,
    });
    localExtractorCache.set(key, extractor);
  }
  return extractor;
}

async function createDefaultExtractor(
  model: string,
  opts: { hfEndpoint: string; cacheDir: string },
) {
  const transformers = await import("@huggingface/transformers");
  const env = (
    transformers as unknown as {
      env?: {
        allowRemoteModels?: boolean;
        remoteHost?: string;
        remotePathTemplate?: string;
        cacheDir?: string;
      };
    }
  ).env;

  if (env) {
    env.allowRemoteModels = true;
    env.remoteHost = opts.hfEndpoint.replace(/\/+$/, "") + "/";
    env.remotePathTemplate = "{model}/resolve/{revision}/{file}";
    env.cacheDir = opts.cacheDir;
  }

  const extractor = await (transformers as unknown as {
    pipeline: (
      task: "feature-extraction",
      model: string,
    ) => Promise<(text: string, opts: { pooling: "mean"; normalize: true }) => Promise<unknown>>;
  }).pipeline("feature-extraction", model);

  return extractor;
}
