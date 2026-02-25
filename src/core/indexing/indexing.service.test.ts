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
      chunking: { sizeChars: 1200, overlapChars: 200, charsPerToken: 4 },
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
  const chunking = {
    async chunkParsedStream(input: AsyncIterable<{ text: string; startOffset: number }>) {
      const chunks: Array<{
        text: string;
        startOffset: number;
        endOffset: number;
        tokenCount: number;
        chunkHash: string;
      }> = [];
      for await (const part of input) {
        chunks.push({
          text: part.text,
          startOffset: part.startOffset,
          endOffset: part.startOffset + part.text.length,
          tokenCount: 1,
          chunkHash: "h",
        });
      }
      return chunks;
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

  const svc = createSourceIndexingService(configService, embedding, chunking, vectorRepo);
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
  const chunking = {
    async chunkParsedStream(input: AsyncIterable<{ text: string; startOffset: number }>) {
      const chunks = [];
      for await (const part of input) {
        chunks.push({
          text: part.text,
          startOffset: part.startOffset,
          endOffset: part.startOffset + part.text.length,
          tokenCount: 1,
          chunkHash: String(part.startOffset),
        });
      }
      return chunks;
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

  const svc = createSourceIndexingService(configService, embedding, chunking, vectorRepo);
  const seenRunningStates: boolean[] = [];
  const unsubscribe = svc.getIndexStatus().subscribe((status) => {
    seenRunningStates.push(status.run.phase === "running");
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
  const chunking = {
    async chunkParsedStream(input: AsyncIterable<{ text: string; startOffset: number }>) {
      const chunks = [];
      for await (const part of input) {
        chunks.push({
          text: part.text,
          startOffset: part.startOffset,
          endOffset: part.startOffset + part.text.length,
          tokenCount: 1,
          chunkHash: String(part.startOffset),
        });
      }
      return chunks;
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

  const svc = createSourceIndexingService(configService, embedding, chunking, vectorRepo);
  const seenCurrentFiles: string[][] = [];
  const unsubscribe = svc.getIndexStatus().subscribe((status) => {
    seenCurrentFiles.push([...status.worker.currentFiles]);
  });

  await svc.runFullRebuild("manual");
  unsubscribe();

  expect(seenCurrentFiles.some((items) => items.includes(filePath))).toBe(true);
  expect(seenCurrentFiles[seenCurrentFiles.length - 1]).toEqual([]);
  expect(seenChunkIds.length).toBeGreaterThan(0);
  for (const chunkId of seenChunkIds) {
    expect(chunkId.startsWith("c_")).toBe(true);
    expect(chunkId.length).toBeLessThanOrEqual(64);
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
  const chunking = {
    async chunkParsedStream(input: AsyncIterable<{ text: string; startOffset: number }>) {
      const chunks = [];
      for await (const part of input) {
        chunks.push({
          text: part.text,
          startOffset: part.startOffset,
          endOffset: part.startOffset + part.text.length,
          tokenCount: 1,
          chunkHash: String(part.startOffset),
        });
      }
      return chunks;
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

  const svc = createSourceIndexingService(configService, embedding, chunking, vectorRepo);
  const result = await svc.runIncremental([{ path: filePath, type: "change" }]);
  expect((result as { indexedFiles: number }).indexedFiles).toBeGreaterThan(0);
  expect(upserts.length).toBeGreaterThan(0);
});

test("full rebuild with embedding_changed reindexes unchanged files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "knowdisk-indexing-embedding-change-"));
  const filePath = join(dir, "a.txt");
  await writeFile(filePath, "hello embedding");
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
  const chunking = {
    async chunkParsedStream(input: AsyncIterable<{ text: string; startOffset: number }>) {
      const chunks = [];
      for await (const part of input) {
        chunks.push({
          text: part.text,
          startOffset: part.startOffset,
          endOffset: part.startOffset + part.text.length,
          tokenCount: 1,
          chunkHash: String(part.startOffset),
        });
      }
      return chunks;
    },
  };
  const upserts: Array<unknown[]> = [];
  const vectorRepo = {
    async upsert(rows: unknown[]) {
      upserts.push(rows);
    },
    async deleteBySourcePath(_sourcePath: string) {
      return;
    },
  };

  const svc = createSourceIndexingService(configService, embedding, chunking, vectorRepo);
  const first = await svc.runFullRebuild("manual");
  cfg = {
    ...cfg,
    embedding: {
      ...cfg.embedding,
      local: {
        ...cfg.embedding.local,
        model: "onnx-community/gte-multilingual-base",
        dimension: 768,
      },
    },
  };
  const second = await svc.runFullRebuild("embedding_changed");

  expect(first.indexedFiles).toBeGreaterThan(0);
  expect(second.indexedFiles).toBeGreaterThan(0);
  expect(upserts.length).toBeGreaterThanOrEqual(2);
});
