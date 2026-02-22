import { isCloudEmbeddingProvider, type EmbeddingConfig, type EmbeddingProvider } from "./embedding.types";
import { embedWithCloudProvider } from "./cloud/cloud.embedding";
import { createDefaultLocalExtractor, embedWithLocalProvider } from "./local/local.embedding";

export function makeEmbeddingProvider(cfg: EmbeddingConfig): EmbeddingProvider {
  return {
    async embed(text: string) {
      if (isCloudEmbeddingProvider(cfg.provider)) {
        return embedWithCloudProvider(cfg, text, fetch);
      }
      return embedWithLocalProvider(cfg, text, createDefaultLocalExtractor);
    },
  };
}
