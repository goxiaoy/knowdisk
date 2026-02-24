export type UiMode = "safe" | "advanced";
export type SourceConfig = {
  path: string;
  enabled: boolean;
};

export type EmbeddingProviderId = "local" | "qwen_dense" | "qwen_sparse" | "openai_dense";
export type RerankerProviderId = "local" | "qwen" | "openai";

export type ModelConfig = {
  hfEndpoint: string;
  cacheDir: string;
};

export type LocalEmbeddingConfig = {
  model: string;
  dimension: number;
};

export type CloudEmbeddingConfig = {
  apiKey: string;
  model: string;
  dimension: number;
};

export type LocalRerankerConfig = {
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
  onboarding: {
    completed: boolean;
  };
  sources: SourceConfig[];
  mcp: {
    enabled: boolean;
    port: number;
  };
  ui: {
    mode: UiMode;
  };
  indexing: {
    chunking: {
      sizeChars: number;
      overlapChars: number;
      charsPerToken: number;
    };
    watch: {
      enabled: boolean;
      debounceMs: number;
    };
    reconcile: {
      enabled: boolean;
      intervalMs: number;
    };
    worker: {
      concurrency: number;
      batchSize: number;
    };
    retry: {
      maxAttempts: number;
      backoffMs: number[];
    };
  };
  retrieval: {
    hybrid: {
      ftsTopN: number;
      vectorTopK: number;
      rerankTopN: number;
    };
  };
  model: ModelConfig;
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

export type ConfigChangeEvent = {
  prev: AppConfig;
  next: AppConfig;
};

export type ConfigService = {
  getConfig: () => AppConfig;
  updateConfig: (updater: (source: AppConfig) => AppConfig) => AppConfig;
  subscribe: (listener: (event: ConfigChangeEvent) => void) => () => void;
};
