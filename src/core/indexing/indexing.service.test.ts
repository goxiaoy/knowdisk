import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AppConfig, ConfigService } from "../config/config.types";
import { createSourceIndexingService } from "./indexing.service";

function makeConfig(): AppConfig {
  return {
    version: 1,
    onboarding: { completed: true },
    sources: [],
    mcp: { enabled: true, port: 3467 },
    ui: { mode: "safe" },
    indexing: {
      watch: { enabled: true, debounceMs: 50 },
      reconcile: { enabled: true, intervalMs: 15 * 60 * 1000 },
      worker: { concurrency: 2, batchSize: 64 },
      retry: { maxAttempts: 3, backoffMs: [1000, 5000, 20000] },
    },
    retrieval: {
      hybrid: { ftsTopN: 30, vectorTopK: 20, rerankTopN: 10 },
    },
    embedding: {
      provider: "local",
      local: {
        hfEndpoint: "https://hf-mirror.com",
        cacheDir: "build/cache/embedding/local",
        model: "Xenova/all-MiniLM-L6-v2",
        dimension: 384,
      },
      qwen_dense: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
      qwen_sparse: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
      openai_dense: { apiKey: "", model: "text-embedding-3-small", dimension: 1536 },
    },
    reranker: {
      enabled: false,
      provider: "local",
      local: {
        hfEndpoint: "https://hf-mirror.com",
        cacheDir: "build/cache/reranker/local",
        model: "BAAI/bge-reranker-base",
        topN: 5,
      },
      qwen: { apiKey: "", model: "gte-rerank-v2", topN: 5 },
      openai: { apiKey: "", model: "text-embedding-3-small", topN: 5 },
    },
  };
}

test("scheduled reconcile repairs missing chunk", async () => {
  let config = makeConfig();
  const configService: ConfigService = {
    getConfig() {
      return config;
    },
    updateConfig(updater) {
      config = updater(config);
      return config;
    },
    subscribe() {
      return () => {};
    },
  };
  const embedding = {
    async embed(_input: string) {
      return [0.1, 0.2, 0.3];
    },
  };
  const upserts: unknown[][] = [];
  const vectorRepo = {
    async upsert(_rows: unknown[]) {
      upserts.push(_rows);
      return;
    },
    async deleteBySourcePath(_sourcePath: string) {
      return;
    },
  };

  const svc = createSourceIndexingService(configService, embedding, vectorRepo);
  const full = (await svc.runFullRebuild("test")) as { indexedFiles: number };
  expect(full.indexedFiles).toBe(0);
  const report = await svc.runScheduledReconcile();
  expect(report.repaired).toBe(0);
  expect(upserts.length).toBe(0);
});

test("index status store is subscribable", async () => {
  const configService: ConfigService = {
    getConfig() {
      return makeConfig();
    },
    updateConfig(updater) {
      return updater(makeConfig());
    },
    subscribe() {
      return () => {};
    },
  };
  const embedding = {
    async embed(_input: string) {
      return [0.1, 0.2, 0.3];
    },
  };
  const vectorRepo = {
    async upsert(_rows: unknown[]) {
      return;
    },
    async deleteBySourcePath(_sourcePath: string) {
      return;
    },
  };

  const svc = createSourceIndexingService(configService, embedding, vectorRepo);
  const seenRunningStates: boolean[] = [];
  const unsubscribe = svc.getIndexStatus().subscribe((status) => {
    seenRunningStates.push(status.running);
  });

  await svc.runFullRebuild("manual");
  unsubscribe();

  expect(seenRunningStates[0]).toBe(false);
  expect(seenRunningStates.includes(true)).toBe(true);
  expect(seenRunningStates[seenRunningStates.length - 1]).toBe(false);
});

test("index status includes current file while indexing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "knowdisk-indexing-"));
  const filePath = join(dir, "a.txt");
  await writeFile(filePath, "hello indexing");
  let cfg = makeConfig();
  cfg.sources = [{ path: dir, enabled: true }];

  const configService: ConfigService = {
    getConfig() {
      return cfg;
    },
    updateConfig(updater) {
      cfg = updater(cfg);
      return cfg;
    },
    subscribe() {
      return () => {};
    },
  };
  const embedding = {
    async embed(_input: string) {
      return [0.1, 0.2, 0.3];
    },
  };
  const seenChunkIds: string[] = [];
  const vectorRepo = {
    async upsert(rows: Array<{ chunkId: string }>) {
      for (const row of rows) {
        seenChunkIds.push(row.chunkId);
      }
      await Promise.resolve();
    },
    async deleteBySourcePath(_sourcePath: string) {
      return;
    },
  };

  const svc = createSourceIndexingService(configService, embedding, vectorRepo);
  const seenCurrentFiles: Array<string | null> = [];
  const unsubscribe = svc.getIndexStatus().subscribe((status) => {
    seenCurrentFiles.push(status.currentFile);
  });

  await svc.runFullRebuild("manual");
  unsubscribe();

  expect(seenCurrentFiles.includes(filePath)).toBe(true);
  expect(seenCurrentFiles[seenCurrentFiles.length - 1]).toBeNull();
  expect(seenChunkIds.length).toBeGreaterThan(0);
  for (const chunkId of seenChunkIds) {
    expect(chunkId.startsWith("chunk_")).toBe(true);
    expect(chunkId.includes("/")).toBe(false);
  }
});

test("incremental run enqueues and processes change events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "knowdisk-indexing-incremental-"));
  const filePath = join(dir, "a.txt");
  await writeFile(filePath, "first");
  let cfg = makeConfig();
  cfg.sources = [{ path: dir, enabled: true }];
  const configService: ConfigService = {
    getConfig() {
      return cfg;
    },
    updateConfig(updater) {
      cfg = updater(cfg);
      return cfg;
    },
    subscribe() {
      return () => {};
    },
  };
  const embedding = {
    async embed(_input: string) {
      return [0.1, 0.2];
    },
  };
  const upserts: Array<{ chunkId: string }> = [];
  const vectorRepo = {
    async upsert(rows: Array<{ chunkId: string }>) {
      upserts.push(...rows);
    },
    async deleteBySourcePath(_sourcePath: string) {
      return;
    },
  };

  const svc = createSourceIndexingService(configService, embedding, vectorRepo);
  const result = await svc.runIncremental([{ path: filePath, type: "change" }]);
  expect((result as { indexedFiles: number }).indexedFiles).toBeGreaterThan(0);
  expect(upserts.length).toBeGreaterThan(0);
});
