export type EmbeddingMode = "local" | "cloud";
export type EmbeddingProviderId =
  | "local"
  | "qwen_dense"
  | "qwen_sparse"
  | "openai_dense";

export type EmbeddingConfig = {
  mode: EmbeddingMode;
  provider: EmbeddingProviderId;
  model: string;
  endpoint?: string;
  apiKeys?: Record<string, string>;
  dimension: number;
};

export type EmbeddingProvider = {
  embed: (text: string) => Promise<number[]>;
};
