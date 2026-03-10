import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

describe("parser error handling", () => {
  test("returns a skipped chunk for empty markdown", async () => {
    const basePath = await createTempDir();
    const service = createParserService({
      vfs: createVfsStub({
        node: createNode({ nodeId: "empty-1", name: "empty.md" }),
        streamText: "",
      }),
      basePath,
      logger: createLoggerStub(),
      converter: {
        id: "stub-converter",
        version: "1.0.0",
        async convert() {
          return { title: null, markdown: "   " };
        },
      },
    });

    const chunks = [];
    for await (const chunk of service.parseNode({ nodeId: "empty-1" })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      status: "skipped",
      error: { code: "EMPTY_MARKDOWN" },
    });
  });

  test("returns an error chunk and writes error.json when conversion fails", async () => {
    const basePath = await createTempDir();
    const logger = createLoggerStub();
    const service = createParserService({
      vfs: createVfsStub({
        node: createNode({ nodeId: "bad-1", mountId: "mount-x", name: "bad.docx" }),
        streamText: "bad binary",
      }),
      basePath,
      logger,
      converter: {
        id: "broken-converter",
        version: "9.9.9",
        async convert() {
          throw new Error("conversion exploded");
        },
      },
    });

    const chunks = [];
    for await (const chunk of service.parseNode({ nodeId: "bad-1" })) {
      chunks.push(chunk);
    }

    const errorPath = service.getCachePaths({ nodeId: "bad-1" }).errorPath;

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      status: "error",
      error: {
        code: "PARSE_ERROR",
        message: "conversion exploded",
      },
    });
    expect(logger.errorCalls).toHaveLength(1);
    expect(await readFile(errorPath, "utf8")).toContain("conversion exploded");
  });
});

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "parser-error-"));
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

function createNode(
  input: Partial<VfsNode> & Pick<VfsNode, "nodeId">,
): VfsNode {
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

function createLoggerStub(): Logger & {
  errorCalls: unknown[];
} {
  return {
    errorCalls: [],
    error(...args: unknown[]) {
      this.errorCalls.push(args);
    },
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
  } as unknown as Logger & { errorCalls: unknown[] };
}
