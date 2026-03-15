import { describe, expect, test } from "bun:test";
import { createIndexingService } from "./indexing.service";
import type { SearchHit } from "./indexing.types";

describe("indexing service rerank", () => {
  test("reranker receives fused rows and topK", async () => {
    const rerankCalls: Array<{ query: string; rows: SearchHit[]; topK: number }> = [];
    const service = createIndexingService(createDeps(rerankCalls));

    await service.search("alpha", { topK: 2 });

    expect(rerankCalls).toHaveLength(1);
    expect(rerankCalls[0]?.query).toBe("alpha");
    expect(rerankCalls[0]?.topK).toBe(2);
    expect(rerankCalls[0]?.rows.map((row) => row.chunkId)).toEqual(["chunk-1", "chunk-2"]);
    expect(rerankCalls[0]?.rows[0]?.scores.fused).toBeNumber();
  });

  test("reranked differs from hybrid when provider is enabled", async () => {
    const service = createIndexingService(createDeps([]));

    const result = await service.search("alpha", { topK: 2 });

    expect(result.hybrid.map((row) => row.chunkId)).toEqual(["chunk-1", "chunk-2"]);
    expect(result.reranked.map((row) => row.chunkId)).toEqual(["chunk-2", "chunk-1"]);
    expect(result.reranked[0]?.scores.rerank).toBeNumber();
  });

  test("fallback behavior when reranker is absent", async () => {
    const service = createIndexingService(createDeps([], { withReranker: false }));

    const result = await service.search("alpha", { topK: 2 });

    expect(result.reranked).toEqual(result.hybrid);
    expect(result.meta.rerankerProvider).toBeNull();
  });
});

function createDeps(
  rerankCalls: Array<{ query: string; rows: SearchHit[]; topK: number }>,
  options: { withReranker?: boolean } = {},
) {
  return {
    logger: {
      error() {},
      warn() {},
      info() {},
      debug() {},
      trace() {},
      fatal() {},
      child() {
        return this;
      },
      level: "info",
    } as never,
    ftsRepository: {
      async replaceNodeChunks() {},
      async deleteByNodeId() {},
      async search() {
        return [createHit("chunk-1", { fts: 0.9, score: 0.9 })];
      },
    },
    vectorRepository: {
      async replaceNodeChunks() {},
      async deleteByNodeId() {},
      async search() {
        return [
          createHit("chunk-1", { vector: 0.8, score: 0.8 }),
          createHit("chunk-2", { vector: 0.7, score: 0.7 }),
        ];
      },
    },
    embeddingRegistry: {
      register() {},
      get() {
        return {
          type: "stub-embedding",
          async embed(text: string) {
            return [text.length, 1];
          },
        };
      },
      listTypes() {
        return ["stub-embedding"];
      },
    },
    rerankerRegistry: {
      register() {},
      get() {
        return {
          type: "stub-reranker",
          async rerank(query: string, rows: SearchHit[], opts: { topK: number }) {
            rerankCalls.push({ query, rows, topK: opts.topK });
            return rows
              .slice(0, opts.topK)
              .reverse()
              .map((row, index) => ({
                ...row,
                score: 1 - index * 0.1,
                scores: {
                  ...row.scores,
                  rerank: 1 - index * 0.1,
                },
              }));
          },
        };
      },
      listTypes() {
        return ["stub-reranker"];
      },
    },
    embedding: {
      type: "stub-embedding",
    },
    reranker:
      options.withReranker === false
        ? null
        : {
            type: "stub-reranker",
          },
    defaults: {
      topK: 5,
    },
  };
}

function createHit(
  chunkId: string,
  scores: { fts?: number; vector?: number; score: number },
): SearchHit {
  return {
    chunkId,
    nodeId: "node-1",
    mountId: "mount-1",
    sourceRef: `docs/${chunkId}.md`,
    name: `${chunkId}.md`,
    title: chunkId.toUpperCase(),
    heading: "Overview",
    text: `${chunkId} body`,
    chunkIndex: chunkId === "chunk-1" ? 0 : 1,
    sectionPath: ["Overview"],
    charStart: 0,
    charEnd: 10,
    score: scores.score,
    scores,
  };
}
