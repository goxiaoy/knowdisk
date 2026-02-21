import { isCloudEmbeddingProvider, type EmbeddingConfig, type EmbeddingProvider } from "./embedding.types";
import { embedWithCloudProvider } from "./cloud/cloud.embedding";
import {
  createDefaultLocalExtractor,
  embedWithLocalProvider,
  type LocalExtractorFactory,
} from "./local/local.embedding";

type EmbeddingDeps = {
  fetchImpl?: typeof fetch;
  createExtractor?: LocalExtractorFactory;
};

export function makeEmbeddingProvider(cfg: EmbeddingConfig, deps?: EmbeddingDeps): EmbeddingProvider {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const createExtractor = deps?.createExtractor ?? createDefaultLocalExtractor;

  return {
    async embed(text: string) {
      if (isCloudEmbeddingProvider(cfg.provider)) {
        return embedWithCloudProvider(cfg, text, fetchImpl);
      }
      return embedWithLocalProvider(cfg, text, createExtractor);
    },
  };
}
