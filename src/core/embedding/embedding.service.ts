import { isCloudEmbeddingProvider, type EmbeddingConfig, type EmbeddingProvider } from "./embedding.types";
import { embedWithCloudProvider } from "./cloud/cloud.embedding";
import { embedWithLocalProvider, initLocalExtractor } from "./local/local.embedding";

export function makeEmbeddingProvider(cfg: EmbeddingConfig): EmbeddingProvider {
  const localExtractorPromise = !isCloudEmbeddingProvider(cfg.provider)
    ? initLocalExtractor(cfg)
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
