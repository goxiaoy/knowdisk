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
    provider: "local" | "qwen_dense" | "qwen_sparse" | "openai_dense";
    endpoint: string;
    apiKeys: Record<string, string>;
    dimension: number;
  };
  modelHub: {
    hfEndpoint: string;
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
  updateModelHub: (input: Partial<AppConfig["modelHub"]>) => AppConfig;
  updateReranker: (input: Partial<AppConfig["reranker"]>) => AppConfig;
};
