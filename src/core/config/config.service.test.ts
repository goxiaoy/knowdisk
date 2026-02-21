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
    expect(cfg.embedding.dimension).toBe(384);
    expect(cfg.reranker.mode).toBe("local");
  });

  test("rejects cloud provider without endpoint", () => {
    const result = validateConfig({
      ...getDefaultConfig(),
      embedding: { mode: "cloud", model: "text-embed-3", endpoint: "", dimension: 1536 },
    });
    expect(result.ok).toBe(false);
  });

  test("migrates v0 config to v1", () => {
    const migrated = migrateConfig({ version: 0, sources: ["docs"] });
    expect(migrated.version).toBe(1);
    expect(migrated.mcp.enabled).toBe(true);
    expect(migrated.sources).toEqual([{ path: "docs", enabled: true }]);
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

  test("supports source CRUD and persists across service instances", () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-config-"));
    const configPath = join(dir, "app-config.json");

    const first = createConfigService({ configPath });
    first.addSource("/Users/a/docs");
    first.addSource("/Users/a/wiki");
    first.updateSource("/Users/a/wiki", false);
    first.removeSource("/Users/a/docs");

    const second = createConfigService({ configPath });
    expect(second.getSources()).toEqual([{ path: "/Users/a/wiki", enabled: false }]);

    rmSync(dir, { recursive: true, force: true });
  });

  test("updates embedding and reranker settings", () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-config-"));
    const configPath = join(dir, "app-config.json");
    const service = createConfigService({ configPath });

    service.updateEmbedding({ model: "BAAI/bge-base-en-v1.5", dimension: 768 });
    service.updateReranker({ mode: "none", topN: 3 });

    const reloaded = createConfigService({ configPath }).getConfig();
    expect(reloaded.embedding.model).toBe("BAAI/bge-base-en-v1.5");
    expect(reloaded.embedding.dimension).toBe(768);
    expect(reloaded.reranker.mode).toBe("none");
    expect(reloaded.reranker.topN).toBe(3);

    rmSync(dir, { recursive: true, force: true });
  });
});
