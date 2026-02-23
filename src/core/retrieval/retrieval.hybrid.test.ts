import { expect, test } from "bun:test";
import { createRetrievalService } from "./retrieval.service";

test("hybrid retrieval merges vector and fts rows then reranks once", async () => {
  let vectorCalled = false;
  let ftsCalled = false;
  let rerankRows = 0;

  const svc = createRetrievalService({
    embedding: {
      async embed() {
        return [1, 0];
      },
    },
    vector: {
      async search() {
        vectorCalled = true;
        return [
          {
            chunkId: "a",
            score: 0.9,
            vector: [],
            metadata: {
              sourcePath: "docs/a.md",
              chunkText: "vector row a",
            },
          },
        ];
      },
      async listBySourcePath() {
        return [];
      },
    },
    fts: {
      searchFts() {
        ftsCalled = true;
        return [
          {
            chunkId: "a",
            fileId: "f1",
            sourcePath: "docs/a.md",
            text: "fts duplicate a",
            score: 0.2,
          },
          {
            chunkId: "b",
            fileId: "f2",
            sourcePath: "docs/b.md",
            text: "fts unique b",
            score: 0.1,
          },
        ];
      },
    },
    reranker: {
      async rerank(_query, rows) {
        rerankRows = rows.length;
        return rows;
      },
    },
    defaults: { topK: 5, ftsTopN: 10 },
  });

  const result = await svc.search("knowdisk", { topK: 3 });

  expect(vectorCalled).toBe(true);
  expect(ftsCalled).toBe(true);
  expect(rerankRows).toBe(2);
  expect(result.map((row) => row.chunkId).sort()).toEqual(["a", "b"]);
});
