import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Logger } from "pino";
import type { VfsNode, VfsOperationCore } from "@knowdisk/vfs";
import { createParserService } from "@knowdisk/parser";

describe("parser package", () => {
  test("exports createParserService", () => {
    expect(typeof createParserService).toBe("function");
  });

  test("supports package-root end-to-end parsing", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "parser-package-"));
    try {
      const service = createParserService({
        vfs: createVfsStub({
          node: createNode({ nodeId: "file-1", name: "guide.md" }),
          streamText: "# Guide\n\nHello from package root",
        }),
        basePath,
        logger: createLoggerStub(),
      });

      const chunks = [];
      for await (const chunk of service.parseNode({ nodeId: "file-1" })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]?.source.nodeId).toBe("file-1");
    } finally {
      await rm(basePath, { recursive: true, force: true });
    }
  });
});

function createVfsStub(input: { node: VfsNode; streamText: string }): VfsOperationCore {
  return {
    async listChildren() {
      return { items: [] };
    },
    async getMetadata() {
      return input.node;
    },
    async createReadStream() {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(input.streamText));
          controller.close();
        },
      });
    },
  };
}

function createNode(input: Partial<VfsNode> & Pick<VfsNode, "nodeId">): VfsNode {
  return {
    nodeId: input.nodeId,
    mountId: input.mountId ?? "mount-1",
    parentId: input.parentId ?? null,
    name: input.name ?? "guide.md",
    kind: input.kind ?? "file",
    size: input.size ?? 12,
    mtimeMs: input.mtimeMs ?? 123,
    sourceRef: input.sourceRef ?? "docs/guide.md",
    providerVersion: input.providerVersion === undefined ? "v1" : input.providerVersion,
    deletedAtMs: input.deletedAtMs ?? null,
    createdAtMs: input.createdAtMs ?? 1,
    updatedAtMs: input.updatedAtMs ?? 1,
  };
}

function createLoggerStub(): Logger {
  return {
    error() {},
    warn() {},
    info() {},
    debug() {},
    trace() {},
    fatal() {},
    silent: () => undefined,
    child() {
      return createLoggerStub();
    },
    level: "info",
  } as unknown as Logger;
}
