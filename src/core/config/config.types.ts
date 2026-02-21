export type UiMode = "safe" | "advanced";

export interface AppConfig {
  version: 1;
  sources: string[];
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
    model: string;
    endpoint: string;
  };
}

export type ConfigService = {
  getConfig: () => AppConfig;
  getMcpEnabled: () => boolean;
  setMcpEnabled: (enabled: boolean) => AppConfig;
};
