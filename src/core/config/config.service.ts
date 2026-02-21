import type { AppConfig } from "./config.types";

export function getDefaultConfig(): AppConfig {
  return {
    version: 1,
    sources: [],
    ui: { mode: "safe" },
    indexing: { watch: { enabled: true } },
    embedding: {
      mode: "local",
      model: "bge-small",
      endpoint: "",
    },
  };
}

export function validateConfig(cfg: AppConfig): { ok: boolean; errors: string[] } {
  if (cfg.embedding.mode === "cloud" && !cfg.embedding.endpoint) {
    return { ok: false, errors: ["embedding.endpoint is required for cloud mode"] };
  }
  return { ok: true, errors: [] };
}

export function migrateConfig(input: unknown): AppConfig {
  const version = (input as { version?: number })?.version ?? 0;
  if (version === 1) {
    return input as AppConfig;
  }

  return { ...getDefaultConfig(), version: 1 };
}
