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
