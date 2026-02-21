export type UiMode = "safe" | "advanced";

export interface AppConfig {
  version: 1;
  sources: string[];
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
