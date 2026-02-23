import { expect, test } from "bun:test";
import { createRetrievalService } from "./retrieval.service";

test("returns deterministic top-k with metadata", async () => {
  const fakeDeps = {
    embedding: {
      async embed(_query: string) {
        return [1, 0];
      },
    },
    vector: {
      async search(_queryVector: number[], opts: { topK: number }) {
        const rows = [
          {
            chunkId: "a",
            score: 0.9,
            metadata: {
              chunkText: "knowdisk setup",
              sourcePath: "docs/a.md",
              updatedAt: "2026-02-21T00:00:00.000Z",
            },
          },
          {
            chunkId: "b",
            score: 0.8,
            metadata: {
              chunkText: "knowdisk guide",
              sourcePath: "docs/b.md",
              updatedAt: "2026-02-21T00:00:00.000Z",
            },
          },
        ];
        return rows.slice(0, opts.topK);
      },
    },
    metadata: {
      listChunksBySourcePath() {
        return [];
      },
    },
    defaults: {
      topK: 5,
    },
  };

  const svc = createRetrievalService(fakeDeps);
  const result = await svc.search("what is knowdisk", { topK: 2 });
  expect(result.length).toBe(2);
  expect(result[0]).toHaveProperty("sourcePath");
  expect(result[0]).toHaveProperty("chunkText");
});

test("applies reranker when configured", async () => {
  let rerankCalled = false;
  const svc = createRetrievalService({
    embedding: { async embed() { return [1, 0]; } },
    vector: {
      async search() {
        return [
          {
            chunkId: "a",
            score: 0.8,
            metadata: { chunkText: "abc", sourcePath: "a.md", updatedAt: "2026-01-01T00:00:00.000Z" },
          },
        ];
      },
    },
    metadata: {
      listChunksBySourcePath() {
        return [];
      },
    },
    reranker: {
      async rerank(_query, rows) {
        rerankCalled = true;
        return rows;
      },
    },
    defaults: { topK: 5 },
  });

  await svc.search("abc", {});
  expect(rerankCalled).toBe(true);
});

test("retrieves all chunks by source path and keeps ordering metadata", async () => {
  const svc = createRetrievalService({
    embedding: { async embed() { return [1, 0]; } },
    vector: {
      async search() {
        return [];
      },
    },
    metadata: {
      listChunksBySourcePath(sourcePath: string) {
        expect(sourcePath).toBe("docs/a.md");
        return [
          {
            chunkId: "c1",
            fileId: "f1",
            sourcePath: "docs/a.md",
            startOffset: 0,
            endOffset: 50,
            chunkHash: "h1",
            tokenCount: 12,
            updatedAtMs: 100,
          },
          {
            chunkId: "c2",
            fileId: "f1",
            sourcePath: "docs/a.md",
            startOffset: 51,
            endOffset: 99,
            chunkHash: "h2",
            tokenCount: 14,
            updatedAtMs: 101,
          },
        ];
      },
    },
    defaults: { topK: 5 },
  });

  const rows = await svc.retrieveBySourcePath("docs/a.md");
  expect(rows.length).toBe(2);
  expect(rows[0]).toMatchObject({
    chunkId: "c1",
    sourcePath: "docs/a.md",
    startOffset: 0,
    endOffset: 50,
    tokenEstimate: 12,
  });
});

test("retrieveBySourcePath resolves chunk text via sourceReader when offsets exist", async () => {
  const svc = createRetrievalService({
    embedding: { async embed() { return [1, 0]; } },
    vector: {
      async search() {
        return [];
      },
    },
    metadata: {
      listChunksBySourcePath() {
        return [
          {
            chunkId: "c1",
            fileId: "f1",
            sourcePath: "docs/a.md",
            startOffset: 10,
            endOffset: 20,
            chunkHash: "h1",
            tokenCount: 3,
            updatedAtMs: 123,
          },
        ];
      },
    },
    sourceReader: {
      async readRange(path: string, startOffset: number, endOffset: number) {
        expect(path).toBe("docs/a.md");
        expect(startOffset).toBe(10);
        expect(endOffset).toBe(20);
        return "resolved-from-source";
      },
    },
    defaults: { topK: 5 },
  });

  const rows = await svc.retrieveBySourcePath("docs/a.md");
  expect(rows[0]?.chunkText).toBe("resolved-from-source");
});

test("getSourceChunkInfoByPath returns raw metadata rows", async () => {
  const svc = createRetrievalService({
    embedding: { async embed() { return [1, 0]; } },
    vector: {
      async search() {
        return [];
      },
    },
    metadata: {
      listChunksBySourcePath(sourcePath: string) {
        expect(sourcePath).toBe("docs/a.md");
        return [
          {
            chunkId: "c1",
            fileId: "f1",
            sourcePath,
            startOffset: 0,
            endOffset: 100,
            chunkHash: "h1",
            tokenCount: 20,
            updatedAtMs: 123,
          },
        ];
      },
    },
    defaults: { topK: 5 },
  });

  const rows = await svc.getSourceChunkInfoByPath("docs/a.md");
  expect(rows).toEqual([
    {
      chunkId: "c1",
      fileId: "f1",
      sourcePath: "docs/a.md",
      startOffset: 0,
      endOffset: 100,
      chunkHash: "h1",
      tokenCount: 20,
      updatedAtMs: 123,
    },
  ]);
});

test("titleOnly search uses only title FTS for scoring", async () => {
  let titleFtsCalled = false;
  let contentFtsCalled = false;
  let embeddingCalled = false;
  let vectorCalled = false;
  const svc = createRetrievalService({
    embedding: { async embed() { embeddingCalled = true; return [1, 0]; } },
    vector: {
      async search() {
        vectorCalled = true;
        return [
          {
            chunkId: "c1",
            score: 0.9,
            vector: [],
            metadata: { sourcePath: "/docs/a/readme.md", title: "readme", chunkText: "chunk-1" },
          },
          {
            chunkId: "c2",
            score: 0.8,
            vector: [],
            metadata: { sourcePath: "/docs/a/readme.md", title: "readme", chunkText: "chunk-2" },
          },
          {
            chunkId: "c3",
            score: 0.7,
            vector: [],
            metadata: { sourcePath: "/docs/b/setup.md", title: "setup", chunkText: "chunk-3" },
          },
        ];
      },
    },
    metadata: {
      listChunksBySourcePath() {
        return [];
      },
    },
    fts: {
      searchFts() {
        contentFtsCalled = true;
        return [];
      },
      searchTitleFts() {
        titleFtsCalled = true;
        return [
          {
            chunkId: "/docs/c/guide.md",
            fileId: "",
            sourcePath: "/docs/c/guide.md",
            text: "/docs/c/guide.md",
            score: 0,
          },
        ];
      },
    },
    defaults: { topK: 5, ftsTopN: 10 },
  });

  const rows = await svc.search("readme", { topK: 5, titleOnly: true });
  expect(titleFtsCalled).toBe(true);
  expect(contentFtsCalled).toBe(false);
  expect(embeddingCalled).toBe(false);
  expect(vectorCalled).toBe(false);
  expect(rows.some((row) => row.sourcePath === "/docs/c/guide.md")).toBe(true);
  expect(rows.find((row) => row.sourcePath === "/docs/c/guide.md")?.chunkText).toBe("/docs/c/guide.md");
});

test("single keyword search mixes title and content with vector scoring", async () => {
  let titleFtsCalled = false;
  let contentFtsCalled = false;
  const svc = createRetrievalService({
    embedding: { async embed() { return [1, 0]; } },
    vector: {
      async search() {
        return [
          {
            chunkId: "v1",
            score: 0.5,
            vector: [],
            metadata: { sourcePath: "/docs/a.md", title: "a", chunkText: "vector row" },
          },
        ];
      },
    },
    metadata: {
      listChunksBySourcePath() {
        return [];
      },
    },
    fts: {
      searchFts() {
        contentFtsCalled = true;
        return [
          { chunkId: "v1", fileId: "f1", sourcePath: "/docs/a.md", text: "content hit", score: 0.2 },
        ];
      },
      searchTitleFts() {
        titleFtsCalled = true;
        return [
          { chunkId: "v1", fileId: "f1", sourcePath: "/docs/a.md", text: "title hit", score: 0.1 },
        ];
      },
    },
    defaults: { topK: 5, ftsTopN: 10 },
  });

  const rows = await svc.search("knowdisk", { topK: 5 });
  expect(contentFtsCalled).toBe(true);
  expect(titleFtsCalled).toBe(true);
  expect(rows[0]?.score).toBeGreaterThan(0.5);
});
