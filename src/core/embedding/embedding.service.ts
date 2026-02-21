import type { EmbeddingConfig, EmbeddingProvider } from "./embedding.types";

export function makeEmbeddingProvider(cfg: EmbeddingConfig): EmbeddingProvider {
  return {
    async embed(text: string) {
      const seed = text.length + cfg.model.length;
      return [seed, seed / 2, seed / 3];
    },
  };
}
