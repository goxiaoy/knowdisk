import { describe, expect, test } from "bun:test";
import { getDefaultConfig, migrateConfig, validateConfig } from "./config.service";

describe("getDefaultConfig", () => {
  test("returns safe-preset defaults", () => {
    const cfg = getDefaultConfig();
    expect(cfg.ui.mode).toBe("safe");
    expect(cfg.indexing.watch.enabled).toBe(true);
  });

  test("rejects cloud provider without endpoint", () => {
    const result = validateConfig({
      ...getDefaultConfig(),
      embedding: { mode: "cloud", model: "text-embed-3", endpoint: "" },
    });
    expect(result.ok).toBe(false);
  });

  test("migrates v0 config to v1", () => {
    const migrated = migrateConfig({ version: 0, sources: [] });
    expect(migrated.version).toBe(1);
  });
});
