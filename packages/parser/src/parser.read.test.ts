import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { VfsNode, VfsOperationCore } from "@knowdisk/vfs";
import { createParserService } from "@knowdisk/parser";

describe("parser vfs read stage", () => {
  test("materializeNode rejects missing nodes", async () => {
    const service = createParserService({
      vfs: createVfsStub(),
      basePath: "/tmp/parser-cache",
      logger: createLoggerStub(),
    });

    await expect(service.materializeNode({ nodeId: "missing" })).rejects.toThrow(
      "Node not found: missing",
    );
  });

  test("materializeNode rejects non-file nodes", async () => {
    const service = createParserService({
      vfs: createVfsStub({
        node: createNode({ nodeId: "folder-1", kind: "folder" }),
      }),
      basePath: "/tmp/parser-cache",
      logger: createLoggerStub(),
    });

    await expect(service.materializeNode({ nodeId: "folder-1" })).rejects.toThrow(
      "Node is not a file: folder-1",
    );
  });

  test("materializeNode reads file bytes from vfs", async () => {
    const service = createParserService({
      vfs: createVfsStub({
        node: createNode({ nodeId: "file-1" }),
        streamText: "hello parser",
      }),
      basePath: "/tmp/parser-cache",
      logger: createLoggerStub(),
    });

    const document = await service.materializeNode({ nodeId: "file-1" });

    expect(document.markdown).toBe("hello parser");
    expect(document.node.nodeId).toBe("file-1");
  });
});

function createVfsStub(input?: {
  node?: VfsNode | null;
  streamText?: string;
}): VfsOperationCore {
  return {
    async listChildren() {
      return { items: [] };
    },
    async getMetadata() {
      return input?.node ?? null;
    },
    async createReadStream() {
      const text = input?.streamText ?? "";
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text));
          controller.close();
        },
      });
    },
  };
}

function createNode(
  input: Partial<VfsNode> & Pick<VfsNode, "nodeId">,
): VfsNode {
  return {
    nodeId: input.nodeId,
    mountId: input.mountId ?? "mount-1",
    parentId: input.parentId ?? null,
    name: input.name ?? "file.txt",
    kind: input.kind ?? "file",
    size: input.size ?? 12,
    mtimeMs: input.mtimeMs ?? 123,
    sourceRef: input.sourceRef ?? "docs/file.txt",
    providerVersion: input.providerVersion ?? "v1",
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
