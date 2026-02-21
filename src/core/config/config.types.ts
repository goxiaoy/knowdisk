export type UiMode = "safe" | "advanced";
export type SourceConfig = {
  path: string;
  enabled: boolean;
};

export interface AppConfig {
  version: 1;
  sources: SourceConfig[];
  mcp: {
    enabled: boolean;
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
    mode: "local" | "cloud";
    provider: "local" | "qwen_dense" | "qwen_sparse" | "openai_dense";
    model: string;
    endpoint: string;
    apiKey: string;
    dimension: number;
  };
  reranker: {
    mode: "none" | "local";
    model: string;
    topN: number;
  };
}

export type ConfigService = {
  getConfig: () => AppConfig;
  getMcpEnabled: () => boolean;
  setMcpEnabled: (enabled: boolean) => AppConfig;
  getSources: () => SourceConfig[];
  addSource: (path: string) => SourceConfig[];
  updateSource: (path: string, enabled: boolean) => SourceConfig[];
  removeSource: (path: string) => SourceConfig[];
  updateEmbedding: (input: Partial<AppConfig["embedding"]>) => AppConfig;
  updateReranker: (input: Partial<AppConfig["reranker"]>) => AppConfig;
};
