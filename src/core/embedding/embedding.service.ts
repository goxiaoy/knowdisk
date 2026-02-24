import { isCloudEmbeddingProvider, type EmbeddingConfig, type EmbeddingProvider } from "./embedding.types";
import { embedWithCloudProvider } from "./cloud/cloud.embedding";
import type { ModelDownloadService } from "../model/model-download.service.types";
import { embedWithLocalProvider } from "./local/local.embedding";

export function makeEmbeddingProvider(
  cfg: EmbeddingConfig,
  modelDownloadService?: ModelDownloadService,
): EmbeddingProvider {
  const localExtractorPromise = !isCloudEmbeddingProvider(cfg.provider)
    ? modelDownloadService?.getLocalEmbeddingExtractor() ??
      Promise.reject(new Error("local embedding extractor unavailable"))
    : null;
  void localExtractorPromise?.catch(() => {});

  return {
    async embed(text: string) {
      if (isCloudEmbeddingProvider(cfg.provider)) {
        return embedWithCloudProvider(cfg, text, fetch);
      }
      const extractor = await localExtractorPromise!;
      return embedWithLocalProvider(text, extractor);
    },
  };
}
