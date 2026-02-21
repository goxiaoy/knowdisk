import type { EmbeddingConfig, EmbeddingProvider } from "./embedding.types";

export function makeEmbeddingProvider(cfg: EmbeddingConfig): EmbeddingProvider {
  return {
    async embed(text: string) {
      const dims = Math.max(1, cfg.dimension);
      const seed = hash(`${cfg.mode}:${cfg.model}:${cfg.endpoint ?? ""}:${text}`);
      const vector = new Array<number>(dims);
      for (let i = 0; i < dims; i += 1) {
        const value = Math.sin(seed * (i + 1)) + Math.cos((seed + i) * 0.37);
        vector[i] = value;
      }
      return normalize(vector);
    },
  };
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
