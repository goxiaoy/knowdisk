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

export async function embedWithLocalProvider(
  text: string,
  extractor: LocalExtractor,
): Promise<number[]> {
  const output = (await extractor(text, {
    pooling: "mean",
    normalize: true,
  })) as { data?: ArrayLike<number> };
  if (!output?.data) {
    throw new Error("local embedding output missing data");
  }
  return Array.from(output.data);
}

export function resolveLocalExtractorFactory(
  createExtractor?: LocalExtractorFactory,
): LocalExtractorFactory {
  return createExtractor ?? createDefaultLocalExtractor;
}

export async function initLocalExtractor(
  cfg: EmbeddingConfig,
  createExtractor?: LocalExtractorFactory,
): Promise<LocalExtractor> {
  const providerDir = join(cfg.local.cacheDir, "provider-local");
  mkdirSync(providerDir, { recursive: true });
  const factory = resolveLocalExtractorFactory(createExtractor);
  return factory(cfg.local.model, {
    hfEndpoint: cfg.local.hfEndpoint,
    cacheDir: providerDir,
  });
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
    // env.remotePathTemplate = "{model}/resolve/{revision}/";
    env.cacheDir = opts.cacheDir;
  }

  return (
    transformers as unknown as {
      pipeline: (
        task: "feature-extraction",
        model: string,
      ) => Promise<LocalExtractor>;
    }
  ).pipeline("feature-extraction", model);
}
