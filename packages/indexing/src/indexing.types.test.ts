import { describe, expect, it } from "bun:test";
import { INDEXING_TYPES_READY } from "./indexing.types";
import type {
  CreateIndexingServiceInput,
  EmbeddingProvider,
  IndexingService,
  RerankerProvider,
  SearchHit,
  SearchResultSet,
} from "./indexing.types";
import type { ParseChunk } from "@knowdisk/parser";
import type { VfsNode } from "@knowdisk/vfs";
import type { Logger } from "pino";

describe("indexing types", () => {
  it("exports runtime sentinel", () => {
    expect(INDEXING_TYPES_READY).toBe(true);
  });

  it("supports the search result contract", () => {
    const hit: SearchHit = {
      chunkId: "chunk-1",
      nodeId: "node-1",
      mountId: "mount-1",
      sourceRef: "docs/readme.md",
      name: "readme.md",
      title: "Readme",
      heading: "Overview",
      text: "Knowdisk overview",
      chunkIndex: 0,
      sectionPath: ["Overview"],
      charStart: 0,
      charEnd: 17,
      score: 0.9,
      scores: {
        fts: 1,
        vector: 0.8,
        fused: 0.9,
        rerank: 0.95,
      },
    };
    const result: SearchResultSet = {
      hybrid: [hit],
      fts: [hit],
      vector: [hit],
      reranked: [hit],
      meta: {
        query: "knowdisk",
        topK: 5,
        titleOnly: false,
        embeddingProvider: "stub-embedding",
        rerankerProvider: "stub-reranker",
      },
    };

    expect(result.hybrid[0]?.scores.fused).toBe(0.9);
    expect(result.meta.embeddingProvider).toBe("stub-embedding");
  });

  it("supports the indexing service contract", async () => {
    const service: IndexingService = {
      async indexNode(_input) {
        return { indexed: 1 };
      },
      async deleteNode(_input) {},
      async rebuildAllFromLocalNodes() {},
      getStatus() {
        return {
          getSnapshot: () => ({
            phase: "idle",
            scope: null,
            processedFiles: 0,
            totalFiles: 0,
            activeNodeName: null,
            error: "",
          }),
          subscribe: () => () => {},
        };
      },
      async search(_query, _opts) {
        return {
          hybrid: [],
          fts: [],
          vector: [],
          reranked: [],
          meta: {
            query: "q",
            topK: 5,
            titleOnly: false,
            embeddingProvider: "stub-embedding",
            rerankerProvider: null,
          },
        };
      },
    };

    expect(typeof service.indexNode).toBe("function");
    expect(await service.indexNode({ nodeId: "node-1" })).toEqual({ indexed: 1 });
    expect(await service.search("q")).toHaveProperty("hybrid");
  });

  it("supports embedding and reranker provider contracts", async () => {
    const embedding: EmbeddingProvider = {
      type: "stub-embedding",
      dimension: 3,
      async embed(text) {
        return [text.length, 1, 0];
      },
      async embedBatch(texts) {
        return texts.map((text) => [text.length, 1, 0]);
      },
    };
    const reranker: RerankerProvider = {
      type: "stub-reranker",
      async rerank(_query, rows, opts) {
        return rows.slice(0, opts.topK).reverse();
      },
    };

    expect(await embedding.embed("abc")).toEqual([3, 1, 0]);
    expect((await embedding.embedBatch?.(["a", "ab"]))?.[1]).toEqual([2, 1, 0]);
    expect(await reranker.rerank("q", [createHit()], { topK: 1 })).toHaveLength(1);
  });
});

function createHit(): SearchHit {
  return {
    chunkId: "chunk-1",
    nodeId: "node-1",
    mountId: "mount-1",
    sourceRef: "docs/readme.md",
    name: "readme.md",
    title: "Readme",
    heading: "Overview",
    text: "Knowdisk overview",
    chunkIndex: 0,
    sectionPath: ["Overview"],
    charStart: 0,
    charEnd: 17,
    score: 0.9,
    scores: {
      fts: 1,
      vector: 0.8,
      fused: 0.9,
    },
  };
}

function createChunk(): ParseChunk {
  return {
    chunkIndex: 0,
    text: "Knowdisk overview",
    markdown: "# Knowdisk overview",
    title: "Readme",
    heading: "Overview",
    sectionId: "section-1",
    sectionPath: ["Overview"],
    charStart: 0,
    charEnd: 17,
    tokenEstimate: 4,
    source: {
      nodeId: "node-1",
      mountId: "mount-1",
      sourceRef: "docs/readme.md",
      name: "readme.md",
      kind: "file",
      size: 17,
      mtimeMs: 1,
      providerVersion: "rev-1",
    },
    parse: {
      parserId: "parser",
      parserVersion: "1.0.0",
      converterId: "converter",
      converterVersion: "1.0.0",
    },
    status: "ok",
  };
}

function createChunks(items: ParseChunk[]): AsyncIterable<ParseChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        yield item;
      }
    },
  };
}

function createNode(): VfsNode {
  return {
    nodeId: "node-1",
    mountId: "mount-1",
    parentId: null,
    name: "readme.md",
    kind: "file",
    size: 17,
    mtimeMs: 1,
    sourceRef: "docs/readme.md",
    providerVersion: "rev-1",
    deletedAtMs: null,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

const _inputShape: CreateIndexingServiceInput = {
  logger: {
    error() {},
    warn() {},
    info() {},
    debug() {},
    trace() {},
    fatal() {},
    silent: () => undefined,
    child() {
      return this as unknown as Logger;
    },
    level: "info",
  } as unknown as Logger,
  parser: {
    parseNode() {
      return createChunks([createChunk()]);
    },
    async clear() {},
  },
  vfs: {
    async getMetadata() {
      return createNode();
    },
    async walkChildren() {
      return { items: [createNode()], source: "local" as const };
    },
  },
  ftsRepository: {
    async replaceNodeChunks() {},
    async deleteByNodeId() {},
    async search() {
      return [];
    },
  },
  vectorRepository: {
    async replaceNodeChunks() {},
    async deleteByNodeId() {},
    async search() {
      return [];
    },
  },
  embeddingRegistry: {
    register() {},
    get() {
      return {
        type: "stub-embedding",
        async embed() {
          return [];
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
};

void _inputShape;
