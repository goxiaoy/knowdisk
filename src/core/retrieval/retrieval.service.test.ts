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
      async listBySourcePath() {
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
      async listBySourcePath() {
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
      async listBySourcePath(sourcePath: string) {
        expect(sourcePath).toBe("docs/a.md");
        return [
          {
            chunkId: "c1",
            score: 0,
            metadata: {
              sourcePath: "docs/a.md",
              chunkText: "chunk a",
              startOffset: 0,
              endOffset: 50,
              tokenEstimate: 12,
            },
          },
          {
            chunkId: "c2",
            score: 0,
            metadata: {
              sourcePath: "docs/a.md",
              chunkText: "chunk b",
              startOffset: 51,
              endOffset: 99,
              tokenEstimate: 14,
            },
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
      async listBySourcePath() {
        return [
          {
            chunkId: "c1",
            score: 0,
            metadata: {
              sourcePath: "docs/a.md",
              chunkText: "preview only",
              startOffset: 10,
              endOffset: 20,
              tokenEstimate: 3,
            },
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
