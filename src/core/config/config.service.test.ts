import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createConfigService,
  getDefaultConfig,
  migrateConfig,
  validateConfig,
} from "./config.service";

describe("getDefaultConfig", () => {
  test("returns safe-preset defaults", () => {
    const cfg = getDefaultConfig();
    expect(cfg.ui.mode).toBe("safe");
    expect(cfg.indexing.watch.enabled).toBe(true);
    expect(cfg.mcp.enabled).toBe(true);
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
    expect(migrated.mcp.enabled).toBe(true);
  });

  test("persists mcp enabled flag across service instances", () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-config-"));
    const configPath = join(dir, "app-config.json");

    const first = createConfigService({ configPath });
    expect(first.getMcpEnabled()).toBe(true);
    first.setMcpEnabled(false);

    const second = createConfigService({ configPath });
    expect(second.getMcpEnabled()).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });
});
