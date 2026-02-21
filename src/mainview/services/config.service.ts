import type { AppConfig, ConfigService } from "../../core/config/config.types";

const STORAGE_KEY = "knowdisk-app-config";

function getDefaultConfig(): AppConfig {
  return {
    version: 1,
    sources: [],
    mcp: { enabled: true },
    ui: { mode: "safe" },
    indexing: { watch: { enabled: true } },
    embedding: { mode: "local", model: "bge-small", endpoint: "" },
  };
}

function loadConfig(): AppConfig {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return getDefaultConfig();
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return {
      ...getDefaultConfig(),
      ...parsed,
      mcp: { enabled: parsed.mcp?.enabled ?? true },
    };
  } catch {
    return getDefaultConfig();
  }
}

function saveConfig(cfg: AppConfig) {
  globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export const defaultMainviewConfigService: ConfigService = {
  getConfig() {
    return loadConfig();
  },
  getMcpEnabled() {
    return loadConfig().mcp.enabled;
  },
  setMcpEnabled(enabled: boolean) {
    const next = { ...loadConfig(), mcp: { enabled } };
    saveConfig(next);
    return next;
  },
};
