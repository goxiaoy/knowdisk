import { describe, expect, test } from "bun:test";
import { createIndexingService } from "./indexing.service";

describe("indexing service delete", () => {
  test("delete removes both FTS and vector rows", async () => {
    const deleted: string[] = [];
    const service = createIndexingService(createDeps(deleted));

    await service.delete({ nodeId: "node-1" });

    expect(deleted).toEqual(["fts:node-1", "vector:node-1"]);
  });

  test("deleting a missing node is a no-op", async () => {
    const deleted: string[] = [];
    const service = createIndexingService(createDeps(deleted));

    await expect(service.delete({ nodeId: "missing" })).resolves.toBeUndefined();
    expect(deleted).toEqual(["fts:missing", "vector:missing"]);
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
