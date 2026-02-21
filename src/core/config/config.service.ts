import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AppConfig, ConfigService } from "./config.types";

export function getDefaultConfig(): AppConfig {
  return {
    version: 1,
    sources: [],
    mcp: {
      enabled: true,
    },
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
    const next = input as Partial<AppConfig>;
    return {
      ...getDefaultConfig(),
      ...next,
      mcp: {
        enabled: next.mcp?.enabled ?? true,
      },
    };
  }

  return { ...getDefaultConfig(), version: 1 };
}

export function createConfigService(opts?: { configPath?: string }): ConfigService {
  const configPath = opts?.configPath ?? "build/app-config.json";
  let cache: AppConfig | null = null;

  function persist(config: AppConfig) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  }

  function load(): AppConfig {
    try {
      const raw = readFileSync(configPath, "utf8");
      const parsed = migrateConfig(JSON.parse(raw));
      const validation = validateConfig(parsed);
      if (!validation.ok) {
        const fallback = getDefaultConfig();
        persist(fallback);
        return fallback;
      }
      return parsed;
    } catch {
      const fallback = getDefaultConfig();
      persist(fallback);
      return fallback;
    }
  }

  return {
    getConfig() {
      if (!cache) {
        cache = load();
      }
      return cache;
    },
    getMcpEnabled() {
      cache = load();
      return cache.mcp.enabled;
    },
    setMcpEnabled(enabled: boolean) {
      const next = { ...this.getConfig(), mcp: { enabled } };
      cache = next;
      persist(next);
      return next;
    },
  };
}

export const defaultConfigService = createConfigService();
