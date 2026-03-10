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

describe("text splitting", () => {
  test("parseNode emits chunks with section metadata", async () => {
    const basePath = await createTempDir();
    const service = createParserService({
      vfs: createVfsStub({
        node: createNode({ nodeId: "file-1", name: "guide.md" }),
        streamText: "# Intro\n\nAlpha Beta Gamma",
      }),
      basePath,
      logger: createLoggerStub(),
      textSplitter: {
        id: "stub-splitter",
        version: "1.0.0",
        async splitText() {
          return ["# Intro", "Alpha Beta", "Gamma"];
        },
      },
    });

    const chunks = [];
    for await (const chunk of service.parseNode({ nodeId: "file-1" })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      "# Intro",
      "Alpha Beta",
      "Gamma",
    ]);
    expect(chunks.every((chunk) => chunk.sectionPath[0] === "Intro")).toBe(true);
    expect(chunks.every((chunk) => chunk.heading === "Intro")).toBe(true);
    expect(chunks.every((chunk) => chunk.status === "ok")).toBe(true);
  });
});

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "parser-splitter-"));
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
    name: input.name ?? "guide.md",
    kind: input.kind ?? "file",
    size: input.size ?? 12,
    mtimeMs: input.mtimeMs ?? 123,
    sourceRef: input.sourceRef ?? "docs/guide.md",
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
