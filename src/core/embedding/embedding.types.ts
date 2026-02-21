export type EmbeddingMode = "local" | "cloud";

export type EmbeddingConfig = {
  mode: EmbeddingMode;
  model: string;
};

export type EmbeddingProvider = {
  embed: (text: string) => Promise<number[]>;
};
