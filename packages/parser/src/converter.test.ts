import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Logger } from "pino";
import type { VfsNode, VfsOperationCore } from "@knowdisk/vfs";
import { createParserService } from "@knowdisk/parser";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("markdown conversion stage", () => {
  test("uses the injected converter result for markdown and title", async () => {
    const basePath = await createTempDir();
    const service = createParserService({
      vfs: createVfsStub({
        node: createNode({ nodeId: "file-1" }),
        streamText: "binary body",
      }),
      basePath,
      logger: createLoggerStub(),
      converter: {
        id: "stub-converter",
        version: "1.2.3",
        async convert() {
          return {
            title: "Converted Title",
            markdown: "# Converted Markdown",
          };
        },
      },
    });

    const document = await service.materializeNode({ nodeId: "file-1" });

    expect(document.title).toBe("Converted Title");
    expect(document.markdown).toBe("# Converted Markdown");
    expect(document.converterId).toBe("stub-converter");
    expect(document.converterVersion).toBe("1.2.3");
  });
});

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "parser-converter-"));
  tempDirs.push(dir);
  return dir;
}

function createVfsStub(input: {
  node: VfsNode;
  streamText: string;
}): VfsOperationCore {
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
    name: input.name ?? "file.docx",
    kind: input.kind ?? "file",
    size: input.size ?? 12,
    mtimeMs: input.mtimeMs ?? 123,
    sourceRef: input.sourceRef ?? "docs/file.docx",
    providerVersion:
      input.providerVersion === undefined ? "v1" : input.providerVersion,
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
