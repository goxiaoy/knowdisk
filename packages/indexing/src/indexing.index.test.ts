import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { ParseChunk } from "@knowdisk/parser";
import type { VfsNode } from "@knowdisk/vfs";
import type { CreateIndexingServiceInput, SearchHit } from "./indexing.types";
import { createIndexingService } from "./indexing.service";

describe("indexing service index flows", () => {
  test("indexNode parses through parser and writes both repositories", async () => {
    const ctx = createHarness();

    const result = await ctx.service.indexNode({ nodeId: "node-1" });

    expect(result).toEqual({ indexed: 2 });
    expect(ctx.parseCalls).toEqual(["node-1"]);
    expect(ctx.metadataCalls).toEqual(["node-1"]);
    expect(ctx.ftsReplaceCalls).toHaveLength(1);
    expect(ctx.vectorReplaceCalls).toHaveLength(1);
    expect(ctx.vectorReplaceCalls[0]?.[0]?.embedding).toEqual([11, 0]);
    expect(ctx.ftsReplaceCalls[0]?.map((row) => row.chunkId)).toEqual([
      buildChunkId("node-1", 0),
      buildChunkId("node-1", 1),
    ]);
  });

  test("indexNode skips non-ok chunks", async () => {
    const ctx = createHarness({
      chunks: [
        createChunk({ chunkIndex: 0, text: "alpha chunk", status: "ok" }),
        createChunk({ chunkIndex: 1, text: "skip me", status: "skipped" }),
        createChunk({
          chunkIndex: 2,
          text: "error me",
          status: "error",
          error: { code: "parse_failed", message: "boom" },
        }),
      ],
    });

    const result = await ctx.service.indexNode({ nodeId: "node-1" });

    expect(result).toEqual({ indexed: 1 });
    expect(ctx.ftsReplaceCalls[0]).toHaveLength(1);
    expect(ctx.vectorReplaceCalls[0]).toHaveLength(1);
  });

  test("rebuildAllFromLocalNodes tracks rebuilding progress and skips unsupported files", async () => {
    const ctx = createHarness({
      roots: [createMountNode()],
      childrenByParent: {
        "mount-1": [
          createNode(),
          createNode({
            nodeId: "video-1",
            name: "clip.mkv",
            sourceRef: "docs/clip.mkv",
          }),
        ],
      },
    });

    const snapshots: string[] = [];
    ctx.service.getStatus().subscribe((status) => {
      snapshots.push(
        `${status.phase}:${status.scope ?? "none"}:${status.processedFiles}/${status.totalFiles}:${status.activeNodeName ?? "-"}`
      );
    });

    await ctx.service.rebuildAllFromLocalNodes();

    expect(ctx.parseCalls).toEqual(["node-1"]);
    expect(snapshots).toContain("rebuilding:full:0/1:-");
    expect(snapshots).toContain("idle:none:1/1:-");
  });
});

function createHarness(input?: {
  chunks?: ParseChunk[];
  roots?: VfsNode[];
  childrenByParent?: Record<string, VfsNode[]>;
}) {
  const deletedNodeIds: string[] = [];
  const parseCalls: string[] = [];
  const metadataCalls: string[] = [];
  const ftsReplaceCalls: CreateIndexingServiceInput["ftsRepository"]["replaceNodeChunks"] extends (
    rows: infer T
  ) => Promise<void>
    ? T[]
    : never = [];
  const vectorReplaceCalls: CreateIndexingServiceInput["vectorRepository"]["replaceNodeChunks"] extends (
    rows: infer T
  ) => Promise<void>
    ? T[]
    : never = [];
  const node = createNode();
  const chunks =
    input?.chunks ??
    [createChunk({ chunkIndex: 0, text: "alpha chunk" }), createChunk({ chunkIndex: 1, text: "beta chunk" })];

  const service = createIndexingService({
    logger: createLoggerStub(),
    parser: {
      parseNode({ nodeId }) {
        parseCalls.push(nodeId);
        return createChunks(chunks);
      },
      async clear() {},
    },
    vfs: {
      async getMetadata({ id }) {
        metadataCalls.push(id);
        return id === node.nodeId ? node : null;
      },
      async walkChildren({ parentNodeId }) {
        if (parentNodeId === null) {
          return { items: input?.roots ?? [createMountNode()], source: "local" as const };
        }
        return {
          items: input?.childrenByParent?.[parentNodeId] ?? [node],
          source: "local" as const,
        };
      },
    },
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
    parseCalls,
    metadataCalls,
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

function createMountNode(): VfsNode {
  return {
    nodeId: "mount-1",
    mountId: "mount-1",
    parentId: null,
    name: "Docs",
    kind: "mount",
    size: null,
    mtimeMs: null,
    sourceRef: "",
    providerVersion: null,
    deletedAtMs: null,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function createNode(overrides: Partial<VfsNode> = {}): VfsNode {
  return {
    nodeId: overrides.nodeId ?? "node-1",
    mountId: overrides.mountId ?? "mount-1",
    parentId: overrides.parentId ?? "mount-1",
    name: overrides.name ?? "readme.md",
    kind: overrides.kind ?? "file",
    size: overrides.size ?? 100,
    mtimeMs: overrides.mtimeMs ?? 1,
    sourceRef: overrides.sourceRef ?? "docs/readme.md",
    providerVersion: overrides.providerVersion ?? "rev-1",
    deletedAtMs: overrides.deletedAtMs ?? null,
    createdAtMs: overrides.createdAtMs ?? 1,
    updatedAtMs: overrides.updatedAtMs ?? 1,
  };
}

function createChunk(
  overrides: Partial<ParseChunk> & Pick<ParseChunk, "chunkIndex" | "text">
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

function buildChunkId(nodeId: string, chunkIndex: number): string {
  return createHash("sha1").update(`${nodeId}:${chunkIndex}`).digest("hex");
}

void ({} as SearchHit);
