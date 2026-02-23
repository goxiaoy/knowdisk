import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect(cfg.onboarding.completed).toBe(false);
    expect(cfg.ui.mode).toBe("safe");
    expect(cfg.indexing.watch.enabled).toBe(true);
    expect(cfg.indexing.watch.debounceMs).toBe(500);
    expect(cfg.indexing.reconcile.enabled).toBe(true);
    expect(cfg.indexing.reconcile.intervalMs).toBe(15 * 60 * 1000);
    expect(cfg.indexing.worker.concurrency).toBe(2);
    expect(cfg.indexing.worker.batchSize).toBe(64);
    expect(cfg.indexing.retry.maxAttempts).toBe(3);
    expect(cfg.indexing.retry.backoffMs).toEqual([1000, 5000, 20000]);
    expect(cfg.mcp.enabled).toBe(true);
    expect(cfg.mcp.port).toBe(3467);
    expect(cfg.retrieval.hybrid.ftsTopN).toBe(30);
    expect(cfg.retrieval.hybrid.vectorTopK).toBe(20);
    expect(cfg.retrieval.hybrid.rerankTopN).toBe(10);
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

  test("rejects invalid mcp port", () => {
    const result = validateConfig({
      ...getDefaultConfig(),
      mcp: { enabled: true, port: 70000 },
    });
    expect(result.ok).toBe(false);
  });

  test("migrates v0 config to v1", () => {
    const migrated = migrateConfig({ version: 0, sources: ["docs"] });
    expect(migrated.version).toBe(1);
    expect(migrated.onboarding.completed).toBe(false);
    expect(migrated.mcp.enabled).toBe(true);
    expect(migrated.sources).toEqual([{ path: "docs", enabled: true }]);
  });

  test("migrates v1 config and marks onboarding completed when sources exist", () => {
    const migrated = migrateConfig({
      version: 1,
      sources: [{ path: "/docs", enabled: true }],
    });
    expect(migrated.onboarding.completed).toBe(true);
  });

  test("normalizes invalid indexing and retrieval values during v1 migration", () => {
    const migrated = migrateConfig({
      version: 1,
      indexing: {
        watch: { enabled: true, debounceMs: -1 },
        reconcile: { enabled: true, intervalMs: 0 },
        worker: { concurrency: 0, batchSize: -10 },
        retry: { maxAttempts: 0, backoffMs: [0, -1] },
      },
      retrieval: {
        hybrid: {
          ftsTopN: 0,
          vectorTopK: -10,
          rerankTopN: 0,
        },
      },
    });

    expect(migrated.indexing.watch.debounceMs).toBe(500);
    expect(migrated.indexing.reconcile.intervalMs).toBe(15 * 60 * 1000);
    expect(migrated.indexing.worker.concurrency).toBe(2);
    expect(migrated.indexing.worker.batchSize).toBe(64);
    expect(migrated.indexing.retry.maxAttempts).toBe(3);
    expect(migrated.indexing.retry.backoffMs).toEqual([1000, 5000, 20000]);
    expect(migrated.retrieval.hybrid.ftsTopN).toBe(30);
    expect(migrated.retrieval.hybrid.vectorTopK).toBe(20);
    expect(migrated.retrieval.hybrid.rerankTopN).toBe(10);
  });

  test("persists mcp enabled flag across service instances", () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-config-"));
    const configPath = join(dir, "app-config.json");

    const first = createConfigService({ configPath });
    expect(first.getConfig().mcp.enabled).toBe(true);
    first.updateConfig((source) => ({
      ...source,
      mcp: { enabled: false, port: source.mcp.port },
    }));

    const second = createConfigService({ configPath });
    expect(second.getConfig().mcp.enabled).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  test("supports source CRUD and persists across service instances", () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-config-"));
    const configPath = join(dir, "app-config.json");

    const first = createConfigService({ configPath });
    first.updateConfig((source) => ({
      ...source,
      sources: [{ path: "/Users/a/wiki", enabled: false }],
    }));

    const second = createConfigService({ configPath });
    expect(second.getConfig().sources).toEqual([{ path: "/Users/a/wiki", enabled: false }]);

    rmSync(dir, { recursive: true, force: true });
  });

  test("collapses nested source directories and keeps parent only", () => {
    const migrated = migrateConfig({
      version: 1,
      sources: [
        { path: "/user/goxy/a/b", enabled: true },
        { path: "/user/goxy/a", enabled: true },
        { path: "/user/goxy/a/b/c", enabled: true },
      ],
    });

    expect(migrated.sources).toEqual([{ path: "/user/goxy/a", enabled: true }]);
  });

  test("preserves input order when collapsing nested sources", () => {
    const migrated = migrateConfig({
      version: 1,
      sources: [
        { path: "/x/y", enabled: true },
        { path: "/a/b", enabled: true },
        { path: "/a", enabled: true },
        { path: "/z", enabled: true },
      ],
    });

    expect(migrated.sources).toEqual([
      { path: "/x/y", enabled: true },
      { path: "/a", enabled: true },
      { path: "/z", enabled: true },
    ]);
  });

  test("normalizes and persists manually edited config on startup", () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-config-"));
    const configPath = join(dir, "app-config.json");
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          version: 1,
          sources: [
            { path: "/user/goxy/a/b/", enabled: true },
            { path: "/user/goxy/a", enabled: true },
          ],
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const service = createConfigService({ configPath });
    expect(service.getConfig().sources).toEqual([{ path: "/user/goxy/a", enabled: true }]);

    const persisted = JSON.parse(readFileSync(configPath, "utf8")) as {
      sources?: Array<{ path: string; enabled: boolean }>;
    };
    expect(persisted.sources).toEqual([{ path: "/user/goxy/a", enabled: true }]);

    rmSync(dir, { recursive: true, force: true });
  });

  test("updates embedding and reranker settings", () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-config-"));
    const configPath = join(dir, "app-config.json");
    const service = createConfigService({ configPath });

    service.updateConfig((source) => ({
      ...source,
      embedding: {
        ...source.embedding,
        provider: "openai_dense",
        openai_dense: {
          apiKey: "sk-test",
          model: "text-embedding-3-large",
          dimension: 3072,
        },
      },
      reranker: {
        ...source.reranker,
        enabled: true,
        provider: "qwen",
        qwen: {
          apiKey: "rk-test",
          model: "gte-rerank-v2",
          topN: 8,
        },
      },
    }));

    const reloaded = createConfigService({ configPath }).getConfig();
    expect(reloaded.embedding.provider).toBe("openai_dense");
    expect(reloaded.embedding.openai_dense.dimension).toBe(3072);
    expect(reloaded.embedding.openai_dense.apiKey).toBe("sk-test");
    expect(reloaded.reranker.provider).toBe("qwen");
    expect(reloaded.reranker.qwen.topN).toBe(8);
    expect(reloaded.reranker.qwen.apiKey).toBe("rk-test");

    rmSync(dir, { recursive: true, force: true });
  });

  test("uses userDataDir for config file and local cache defaults", () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "knowdisk-user-data-"));
    const service = createConfigService({ userDataDir });
    const config = service.getConfig();

    expect(existsSync(join(userDataDir, "app-config.json"))).toBe(true);
    expect(config.embedding.local.cacheDir).toBe(join(userDataDir, "cache", "embedding", "local"));
    expect(config.reranker.local.cacheDir).toBe(join(userDataDir, "cache", "reranker", "local"));

    rmSync(userDataDir, { recursive: true, force: true });
  });

  test("emits config change events on update and supports unsubscribe", () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-config-"));
    const configPath = join(dir, "app-config.json");
    const service = createConfigService({ configPath });
    const events: Array<{ prevEnabled: boolean; nextEnabled: boolean }> = [];

    const unsubscribe = service.subscribe((event) => {
      events.push({
        prevEnabled: event.prev.mcp.enabled,
        nextEnabled: event.next.mcp.enabled,
      });
    });

    service.updateConfig((source) => ({
      ...source,
      mcp: { ...source.mcp, enabled: false },
    }));
    unsubscribe();
    service.updateConfig((source) => ({
      ...source,
      mcp: { ...source.mcp, enabled: true },
    }));

    expect(events).toEqual([{ prevEnabled: true, nextEnabled: false }]);

    rmSync(dir, { recursive: true, force: true });
  });
});
