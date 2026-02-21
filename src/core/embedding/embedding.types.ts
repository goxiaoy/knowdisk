import type { AppConfig, EmbeddingProviderId } from "../config/config.types";

export function isCloudEmbeddingProvider(provider: EmbeddingProviderId): boolean {
  return provider !== "local";
}

export function getEmbeddingProviderModel(provider: EmbeddingProviderId): string {
  if (provider === "openai_dense") return "text-embedding-3-small";
  if (provider === "qwen_dense") return "text-embedding-v4";
  if (provider === "qwen_sparse") return "text-embedding-v4";
  return "Xenova/all-MiniLM-L6-v2";
}

export type EmbeddingConfig = {
  provider: EmbeddingProviderId;
  local: AppConfig["embedding"]["local"];
  qwen_dense: AppConfig["embedding"]["qwen_dense"];
  qwen_sparse: AppConfig["embedding"]["qwen_sparse"];
  openai_dense: AppConfig["embedding"]["openai_dense"];
};

export type EmbeddingProvider = {
  embed: (text: string) => Promise<number[]>;
};
