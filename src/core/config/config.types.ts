export type UiMode = "safe" | "advanced";
export type SourceConfig = {
  path: string;
  enabled: boolean;
};

export type EmbeddingProviderId = "local" | "qwen_dense" | "qwen_sparse" | "openai_dense";
export type RerankerProviderId = "local" | "qwen" | "openai";

export type LocalEmbeddingConfig = {
  hfEndpoint: string;
  cacheDir: string;
  model: string;
  dimension: number;
};

export type CloudEmbeddingConfig = {
  apiKey: string;
  model: string;
  dimension: number;
};

export type LocalRerankerConfig = {
  hfEndpoint: string;
  cacheDir: string;
  model: string;
  topN: number;
};

export type CloudRerankerConfig = {
  apiKey: string;
  model: string;
  topN: number;
};

export interface AppConfig {
  version: 1;
  sources: SourceConfig[];
  mcp: {
    enabled: boolean;
    port: number;
  };
  ui: {
    mode: UiMode;
  };
  indexing: {
    watch: {
      enabled: boolean;
    };
  };
  embedding: {
    provider: EmbeddingProviderId;
    local: LocalEmbeddingConfig;
    qwen_dense: CloudEmbeddingConfig;
    qwen_sparse: CloudEmbeddingConfig;
    openai_dense: CloudEmbeddingConfig;
  };
  reranker: {
    enabled: boolean;
    provider: RerankerProviderId;
    local: LocalRerankerConfig;
    qwen: CloudRerankerConfig;
    openai: CloudRerankerConfig;
  };
}

export type ConfigService = {
  getConfig: () => AppConfig;
  updateConfig: (updater: (source: AppConfig) => AppConfig) => AppConfig;
};
