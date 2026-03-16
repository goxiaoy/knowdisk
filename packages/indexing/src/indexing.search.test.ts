import { describe, expect, test } from "bun:test";
import { createIndexingService } from "./indexing.service";
import type { SearchHit } from "./indexing.types";

describe("indexing service search", () => {
  test("returns hybrid, fts, vector, reranked, meta", async () => {
    const service = createDeps().service;

    const result = await service.search("alpha", { topK: 3 });

    expect(result.meta).toEqual({
      query: "alpha",
      topK: 3,
      titleOnly: false,
      embeddingProvider: "stub-embedding",
      rerankerProvider: null,
    });
    expect(result.fts).toHaveLength(1);
    expect(result.vector).toHaveLength(2);
    expect(result.hybrid.length).toBeGreaterThan(0);
    expect(result.reranked).toEqual(result.hybrid);
  });

  test("merges rows by chunkId", async () => {
    const service = createDeps().service;

    const result = await service.search("alpha", { topK: 5 });

    expect(result.hybrid).toHaveLength(2);
    expect(result.hybrid[0]?.chunkId).toBe("chunk-1");
  });

  test("empty query returns empty result sets", async () => {
    const service = createDeps().service;

    const result = await service.search("   ");

    expect(result.hybrid).toEqual([]);
    expect(result.fts).toEqual([]);
    expect(result.vector).toEqual([]);
    expect(result.reranked).toEqual([]);
  });

  test("titleOnly skips vector and only searches title fields", async () => {
    const { service, embeddingCalls, vectorSearchCalls, ftsSearchCalls } = createDeps();

    const result = await service.search("title", { topK: 2, titleOnly: true });

    expect(embeddingCalls).toHaveLength(0);
    expect(vectorSearchCalls).toHaveLength(0);
    expect(ftsSearchCalls).toEqual([{ query: "title", opts: { topK: 2, titleOnly: true } }]);
    expect(result.vector).toEqual([]);
  });

  test("score buckets populate scores.fts, scores.vector, scores.fused", async () => {
    const service = createDeps().service;

    const result = await service.search("alpha", { topK: 5 });
    const hit = result.hybrid.find((item) => item.chunkId === "chunk-1");

    expect(hit?.scores.fts).toBeNumber();
    expect(hit?.scores.vector).toBeNumber();
    expect(hit?.scores.fused).toBeNumber();
  });
});

function createDeps() {
  const embeddingCalls: string[] = [];
  const vectorSearchCalls: Array<{ queryVector: number[]; opts: { topK: number } }> = [];
  const ftsSearchCalls: Array<{ query: string; opts: { topK: number; titleOnly?: boolean } }> = [];
  const service = createIndexingService({
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
    parser: {
      parseNode() {
        return {
          async *[Symbol.asyncIterator]() {},
        };
      },
      async clear() {},
    },
    vfs: {
      async getMetadata() {
        return null;
      },
      async walkChildren() {
        return { items: [], source: "local" as const };
      },
    },
    ftsRepository: {
      async replaceNodeChunks() {},
      async deleteByNodeId() {},
      async search(query, opts) {
        ftsSearchCalls.push({ query, opts });
        return [createHit("chunk-1", { fts: 0.9, score: 0.9 })];
      },
    },
    vectorRepository: {
      async replaceNodeChunks() {},
      async deleteByNodeId() {},
      async search(queryVector, opts) {
        vectorSearchCalls.push({ queryVector, opts });
        return [
          createHit("chunk-1", { vector: 0.8, score: 0.8 }),
          createHit("chunk-2", { vector: 0.6, score: 0.6 }),
        ];
      },
    },
    embeddingRegistry: {
      register() {},
      get() {
        return {
          type: "stub-embedding",
          async embed(text) {
            embeddingCalls.push(text);
            return [text.length, 1];
          },
        };
      },
      listTypes() {
        return ["stub-embedding"];
      },
    },
    embedding: {
      type: "stub-embedding",
    },
    defaults: {
      topK: 5,
    },
  });

  return { service, embeddingCalls, vectorSearchCalls, ftsSearchCalls };
}

function createHit(
  chunkId: string,
  scores: { fts?: number; vector?: number; score: number }
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
