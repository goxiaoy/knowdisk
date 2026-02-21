export type EmbeddingMode = "local" | "cloud";

export type EmbeddingConfig = {
  mode: EmbeddingMode;
  model: string;
  endpoint?: string;
  dimension: number;
};

export type EmbeddingProvider = {
  embed: (text: string) => Promise<number[]>;
};
