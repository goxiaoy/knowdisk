import {
  getEmbeddingProviderModel,
  isCloudEmbeddingProvider,
  type EmbeddingConfig,
  type EmbeddingProvider,
} from "./embedding.types";

type EmbeddingDeps = {
  fetchImpl?: typeof fetch;
  createExtractor?: (
    model: string,
    opts: { hfEndpoint?: string },
  ) => Promise<(text: string, opts: { pooling: "mean"; normalize: true }) => Promise<unknown>>;
};

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

const localExtractorCache = new Map<
  string,
  Promise<(text: string, opts: { pooling: "mean"; normalize: true }) => Promise<unknown>>
>();

async function getLocalExtractor(
  cfg: EmbeddingConfig,
  createExtractor: (
    model: string,
    opts: { hfEndpoint?: string },
  ) => Promise<(text: string, opts: { pooling: "mean"; normalize: true }) => Promise<unknown>>,
) {
  const model = getEmbeddingProviderModel("local");
  const key = `${model}|${cfg.hfEndpoint ?? ""}`;
  let extractor = localExtractorCache.get(key);
  if (!extractor) {
    extractor = createExtractor(model, { hfEndpoint: cfg.hfEndpoint });
    localExtractorCache.set(key, extractor);
  }
  return extractor;
}

async function createDefaultExtractor(model: string, opts: { hfEndpoint?: string }) {
  const transformers = await import("@huggingface/transformers");
  const env = (
    transformers as unknown as {
      env?: { allowRemoteModels?: boolean; remoteHost?: string; remotePathTemplate?: string };
    }
  ).env;

  if (env) {
    env.allowRemoteModels = true;
    if (opts.hfEndpoint) {
      env.remoteHost = opts.hfEndpoint.replace(/\/+$/, "") + "/";
      env.remotePathTemplate = "{model}/resolve/{revision}/{file}";
    }
  }

  const extractor = await (transformers as unknown as {
    pipeline: (
      task: "feature-extraction",
      model: string,
    ) => Promise<(text: string, opts: { pooling: "mean"; normalize: true }) => Promise<unknown>>;
  }).pipeline("feature-extraction", model);
  return extractor;
}
