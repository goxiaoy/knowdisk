import { describe, expect, test } from "bun:test";
import type { ParseChunk } from "@knowdisk/parser";
import type { VfsNode } from "@knowdisk/vfs";
import type { CreateIndexingServiceInput, SearchHit } from "./indexing.types";
import { createIndexingService } from "./indexing.service";

describe("indexing service index", () => {
  test("indexes one node from AsyncIterable<ParseChunk>", async () => {
    const ctx = createHarness();

    const result = await ctx.service.index({
      node: createNode(),
      chunks: createChunks([
        createChunk({ chunkIndex: 0, text: "alpha chunk" }),
        createChunk({ chunkIndex: 1, text: "beta chunk" }),
      ]),
    });

    expect(result).toEqual({ indexed: 2 });
    expect(ctx.ftsReplaceCalls).toHaveLength(1);
    expect(ctx.vectorReplaceCalls).toHaveLength(1);
    expect(ctx.vectorReplaceCalls[0]?.[0]?.embedding).toEqual([11, 0]);
    expect(ctx.ftsReplaceCalls[0]?.map((row) => row.chunkId)).toEqual([
      "node-1:0",
      "node-1:1",
    ]);
  });

  test("skips non-ok chunks", async () => {
    const ctx = createHarness();

    const result = await ctx.service.index({
      node: createNode(),
      chunks: createChunks([
        createChunk({ chunkIndex: 0, text: "alpha chunk", status: "ok" }),
        createChunk({ chunkIndex: 1, text: "skip me", status: "skipped" }),
        createChunk({
          chunkIndex: 2,
          text: "error me",
          status: "error",
          error: { code: "parse_failed", message: "boom" },
        }),
      ]),
    });

    expect(result).toEqual({ indexed: 1 });
    expect(ctx.ftsReplaceCalls[0]).toHaveLength(1);
    expect(ctx.vectorReplaceCalls[0]).toHaveLength(1);
  });

  test("replaces old rows for the same nodeId", async () => {
    const ctx = createHarness();

    await ctx.service.index({
      node: createNode(),
      chunks: createChunks([createChunk({ chunkIndex: 0, text: "alpha chunk" })]),
    });

    expect(ctx.deletedNodeIds).toEqual(["node-1", "node-1"]);
  });
});

function createHarness() {
  const deletedNodeIds: string[] = [];
  const ftsReplaceCalls: CreateIndexingServiceInput["ftsRepository"]["replaceNodeChunks"] extends (
    rows: infer T,
  ) => Promise<void>
    ? T[]
    : never = [];
  const vectorReplaceCalls: CreateIndexingServiceInput["vectorRepository"]["replaceNodeChunks"] extends (
    rows: infer T,
  ) => Promise<void>
    ? T[]
    : never = [];

  const service = createIndexingService({
    logger: createLoggerStub(),
    ftsRepository: {
      async replaceNodeChunks(rows) {
        ftsReplaceCalls.push(rows);
      },
      async deleteByNodeId(nodeId) {
        deletedNodeIds.push(nodeId);
      },
      async search() {
        return [];
      },
    },
    vectorRepository: {
      async replaceNodeChunks(rows) {
        vectorReplaceCalls.push(rows);
      },
      async deleteByNodeId(nodeId) {
        deletedNodeIds.push(nodeId);
      },
      async search() {
        return [];
      },
    },
    embeddingRegistry: {
      register() {},
      get() {
        return {
          type: "stub-embedding",
          async embed(text) {
            return [text.length, 0];
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
  });

  return {
    service,
    deletedNodeIds,
    ftsReplaceCalls,
    vectorReplaceCalls,
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
    sectionId: overrides.sectionId ?? "section-1",
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

void ({} as SearchHit);
