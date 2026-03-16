import { describe, expect, test } from "bun:test";
import { createIndexingService } from "./indexing.service";

describe("indexing service delete", () => {
  test("delete removes both FTS and vector rows", async () => {
    const deleted: string[] = [];
    const service = createIndexingService(createDeps(deleted));

    await service.deleteNode({ nodeId: "node-1" });

    expect(deleted).toEqual(["parser:node-1", "fts:node-1", "vector:node-1"]);
  });

  test("deleting a missing node is a no-op", async () => {
    const deleted: string[] = [];
    const service = createIndexingService(createDeps(deleted));

    await expect(service.deleteNode({ nodeId: "missing" })).resolves.toBeUndefined();
    expect(deleted).toEqual(["parser:missing", "fts:missing", "vector:missing"]);
  });
});

function createDeps(deleted: string[]) {
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
    parser: {
      parseNode() {
        return {
          async *[Symbol.asyncIterator]() {},
        };
      },
      async clear({ nodeId }: { nodeId: string }) {
        deleted.push(`parser:${nodeId}`);
      },
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
      async deleteByNodeId(nodeId: string) {
        deleted.push(`fts:${nodeId}`);
      },
      async search() {
        return [];
      },
    },
    vectorRepository: {
      async replaceNodeChunks() {},
      async deleteByNodeId(nodeId: string) {
        deleted.push(`vector:${nodeId}`);
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
          async embed() {
            return [0];
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
}
