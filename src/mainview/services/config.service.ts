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
    const normalizedSources = Array.isArray(parsed.sources)
      ? parsed.sources.map((item) =>
          typeof item === "string"
            ? { path: item, enabled: true }
            : { path: String(item.path ?? ""), enabled: item.enabled ?? true },
        )
      : [];

    return {
      ...getDefaultConfig(),
      ...parsed,
      sources: normalizedSources.filter((item) => item.path.length > 0),
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
  getSources() {
    return loadConfig().sources;
  },
  addSource(path: string) {
    const current = loadConfig();
    if (current.sources.some((item) => item.path === path)) {
      return current.sources;
    }
    const sources = [...current.sources, { path, enabled: true }];
    saveConfig({ ...current, sources });
    return sources;
  },
  updateSource(path: string, enabled: boolean) {
    const current = loadConfig();
    const sources = current.sources.map((item) =>
      item.path === path ? { ...item, enabled } : item,
    );
    saveConfig({ ...current, sources });
    return sources;
  },
  removeSource(path: string) {
    const current = loadConfig();
    const sources = current.sources.filter((item) => item.path !== path);
    saveConfig({ ...current, sources });
    return sources;
  },
};
