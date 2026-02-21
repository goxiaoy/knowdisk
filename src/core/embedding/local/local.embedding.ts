import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { EmbeddingConfig } from "../embedding.types";

export type LocalExtractor = (
  text: string,
  opts: { pooling: "mean"; normalize: true },
) => Promise<unknown>;

export type LocalExtractorFactory = (
  model: string,
  opts: { hfEndpoint: string; cacheDir: string },
) => Promise<LocalExtractor>;

const localExtractorCache = new Map<string, Promise<LocalExtractor>>();

export async function embedWithLocalProvider(
  cfg: EmbeddingConfig,
  text: string,
  createExtractor: LocalExtractorFactory,
): Promise<number[]> {
  const extractor = await getLocalExtractor(cfg, createExtractor);
  const output = (await extractor(text, {
    pooling: "mean",
    normalize: true,
  })) as { data?: ArrayLike<number> };
  if (!output?.data) {
    throw new Error("local embedding output missing data");
  }
  return Array.from(output.data);
}

async function getLocalExtractor(
  cfg: EmbeddingConfig,
  createExtractor: LocalExtractorFactory,
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

export async function createDefaultLocalExtractor(
  model: string,
  opts: { hfEndpoint: string; cacheDir: string },
): Promise<LocalExtractor> {
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

  return (transformers as unknown as {
    pipeline: (
      task: "feature-extraction",
      model: string,
    ) => Promise<LocalExtractor>;
  }).pipeline("feature-extraction", model);
}
