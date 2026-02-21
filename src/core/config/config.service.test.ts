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
    expect(cfg.embedding.local.dimension).toBe(384);
    expect(cfg.embedding.local.hfEndpoint).toBe("https://hf-mirror.com");
    expect(cfg.reranker.local.topN).toBe(5);
  });

  test("rejects cloud provider without api key", () => {
    const result = validateConfig({
      ...getDefaultConfig(),
      embedding: {
        ...getDefaultConfig().embedding,
        provider: "qwen_dense",
        qwen_dense: {
          ...getDefaultConfig().embedding.qwen_dense,
          apiKey: "",
        },
      },
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

    service.updateEmbedding({
      provider: "openai_dense",
      openai_dense: {
        apiKey: "sk-test",
        model: "text-embedding-3-large",
        dimension: 3072,
      },
    });
    service.updateReranker({
      enabled: true,
      provider: "qwen",
      qwen: {
        apiKey: "rk-test",
        model: "gte-rerank-v2",
        topN: 8,
      },
    });

    const reloaded = createConfigService({ configPath }).getConfig();
    expect(reloaded.embedding.provider).toBe("openai_dense");
    expect(reloaded.embedding.openai_dense.dimension).toBe(3072);
    expect(reloaded.embedding.openai_dense.apiKey).toBe("sk-test");
    expect(reloaded.reranker.provider).toBe("qwen");
    expect(reloaded.reranker.qwen.topN).toBe(8);
    expect(reloaded.reranker.qwen.apiKey).toBe("rk-test");

    rmSync(dir, { recursive: true, force: true });
  });
});
