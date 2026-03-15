import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { container as rootContainer } from "tsyringe";
import type { ParseChunk } from "@knowdisk/parser";
import type { VfsNode } from "@knowdisk/vfs";
import {
  createEmbeddingRegistry,
  createIndexingService,
  createRerankerRegistry,
} from "@knowdisk/indexing";
import { createFtsRepository } from "./fts";
import { createVectorRepository } from "./vector";

describe("indexing package e2e", () => {
  test("indexing and searching return consistent metadata and debug outputs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-indexing-e2e-"));
    const child = rootContainer.createChildContainer();
    const embeddingRegistry = createEmbeddingRegistry(child);
    const rerankerRegistry = createRerankerRegistry(child);
    const ftsRepository = createFtsRepository({
      dbPath: join(dir, "indexing.db"),
    });
    const vectorRepository = createVectorRepository({
      collectionPath: join(dir, "vectors.zvec"),
    });
    embeddingRegistry.register("stub-embedding", () => ({
      type: "stub-embedding",
      async embed(text: string) {
        if (text.toLowerCase().includes("alpha")) {
          return [1, 0];
        }
        return [0, 1];
      },
      async embedBatch(texts: string[]) {
        return texts.map((text) =>
          text.toLowerCase().includes("alpha") ? [1, 0] : [0, 1],
        );
      },
    }));
    rerankerRegistry.register("stub-reranker", () => ({
      type: "stub-reranker",
      async rerank(_query, rows, opts) {
        return rows.slice(0, opts.topK).map((row, index) => ({
          ...row,
          score: 1 - index * 0.1,
          scores: {
            ...row.scores,
            rerank: 1 - index * 0.1,
          },
        }));
      },
    }));

    const service = createIndexingService({
      logger: createLoggerStub(),
      ftsRepository,
      vectorRepository,
      embeddingRegistry,
      rerankerRegistry,
      embedding: {
        type: "stub-embedding",
      },
      reranker: {
        type: "stub-reranker",
      },
      defaults: {
        topK: 5,
      },
    });

    const node = createNode();
    const indexed = await service.index({
      node,
      chunks: createChunks([
        createChunk({ chunkIndex: 0, text: "alpha indexing overview", title: "Alpha" }),
        createChunk({ chunkIndex: 1, text: "beta appendix", title: "Beta" }),
      ]),
    });
    const result = await service.search("alpha", { topK: 2 });

    expect(indexed).toEqual({ indexed: 2 });
    expect(result.meta).toEqual({
      query: "alpha",
      topK: 2,
      titleOnly: false,
      embeddingProvider: "stub-embedding",
      rerankerProvider: "stub-reranker",
    });
    expect(result.fts.map((hit) => hit.chunkId)).toContain(buildChunkId("node-1", 0));
    expect(result.vector.map((hit) => hit.chunkId)).toContain(buildChunkId("node-1", 0));
    expect(result.hybrid[0]).toMatchObject({
      chunkId: buildChunkId("node-1", 0),
      nodeId: "node-1",
      mountId: "mount-1",
      sourceRef: "docs/readme.md",
      name: "readme.md",
      title: "Alpha",
    });
    expect(result.reranked[0]?.scores.rerank).toBeNumber();
    expect(result.hybrid[0]?.scores.fused).toBeNumber();

    ftsRepository.close();
    vectorRepository.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

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
    size: 100,
    mtimeMs: 1,
    sourceRef: "docs/readme.md",
    providerVersion: "rev-1",
    deletedAtMs: null,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function createChunk(
  overrides: Partial<ParseChunk> & Pick<ParseChunk, "chunkIndex" | "text">,
): ParseChunk {
  return {
    chunkIndex: overrides.chunkIndex,
    text: overrides.text,
    markdown: overrides.markdown ?? `# ${overrides.text}`,
    title: overrides.title ?? "Readme",
    heading: overrides.heading ?? "Overview",
    sectionId: overrides.sectionId ?? `section-${overrides.chunkIndex}`,
    sectionPath: overrides.sectionPath ?? ["Overview"],
    charStart: overrides.charStart ?? 0,
    charEnd: overrides.charEnd ?? overrides.text.length,
    tokenEstimate: overrides.tokenEstimate ?? 4,
    source: overrides.source ?? {
      nodeId: "node-1",
      mountId: "mount-1",
      sourceRef: "docs/readme.md",
      name: "readme.md",
      kind: "file",
      size: overrides.text.length,
      mtimeMs: 1,
      providerVersion: "rev-1",
    },
    parse: overrides.parse ?? {
      parserId: "parser",
      parserVersion: "1.0.0",
      converterId: "converter",
      converterVersion: "1.0.0",
    },
    status: overrides.status ?? "ok",
    error: overrides.error,
  };
}

function createLoggerStub() {
  return {
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
  } as never;
}

function buildChunkId(nodeId: string, chunkIndex: number): string {
  return createHash("sha1")
    .update(`${nodeId}:${chunkIndex}`)
    .digest("hex");
}
