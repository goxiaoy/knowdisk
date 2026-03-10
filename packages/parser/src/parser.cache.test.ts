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

describe("parser markdown cache", () => {
  test("writes markdown and manifest under mount and node cache paths", async () => {
    const basePath = await createTempDir();
    const vfs = createCountingVfs({
      node: createNode({ nodeId: "file-1", mountId: "mount-a", providerVersion: "v1" }),
      streamText: "cached text",
    });
    const service = createParserService({
      vfs,
      basePath,
      logger: createLoggerStub(),
    });

    const document = await service.materializeNode({ nodeId: "file-1" });
    const cachePaths = service.getCachePaths({ nodeId: "file-1" });

    expect(document.markdown).toBe("cached text");
    expect(cachePaths.dir).toBe(join(basePath, "mount-a", "file-1"));
    expect(await readFile(cachePaths.markdownPath, "utf8")).toBe("cached text");
    expect(JSON.parse(await readFile(cachePaths.manifestPath, "utf8"))).toMatchObject({
      nodeId: "file-1",
      mountId: "mount-a",
      providerVersion: "v1",
    });
    expect(vfs.readCount).toBe(1);
  });

  test("reuses cached markdown when providerVersion matches", async () => {
    const basePath = await createTempDir();
    const node = createNode({ nodeId: "file-2", mountId: "mount-a", providerVersion: "v1" });
    const vfs = createCountingVfs({
      node,
      streamText: "first read",
    });
    const service = createParserService({
      vfs,
      basePath,
      logger: createLoggerStub(),
    });

    await service.materializeNode({ nodeId: "file-2" });
    vfs.streamText = "second read should not happen";

    const document = await service.materializeNode({ nodeId: "file-2" });

    expect(document.markdown).toBe("first read");
    expect(vfs.readCount).toBe(1);
  });

  test("rebuilds cached markdown when providerVersion changes", async () => {
    const basePath = await createTempDir();
    const node = createNode({ nodeId: "file-3", mountId: "mount-a", providerVersion: "v1" });
    const vfs = createCountingVfs({
      node,
      streamText: "v1 body",
    });
    const service = createParserService({
      vfs,
      basePath,
      logger: createLoggerStub(),
    });

    await service.materializeNode({ nodeId: "file-3" });
    vfs.node = { ...node, providerVersion: "v2" };
    vfs.streamText = "v2 body";

    const document = await service.materializeNode({ nodeId: "file-3" });

    expect(document.markdown).toBe("v2 body");
    expect(vfs.readCount).toBe(2);
  });

  test("does not reuse cache when providerVersion is missing", async () => {
    const basePath = await createTempDir();
    const vfs = createCountingVfs({
      node: createNode({ nodeId: "file-4", mountId: "mount-a", providerVersion: null }),
      streamText: "first uncached read",
    });
    const service = createParserService({
      vfs,
      basePath,
      logger: createLoggerStub(),
    });

    await service.materializeNode({ nodeId: "file-4" });
    vfs.streamText = "second uncached read";

    const document = await service.materializeNode({ nodeId: "file-4" });

    expect(document.markdown).toBe("second uncached read");
    expect(vfs.readCount).toBe(2);
  });
});

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "parser-cache-"));
  tempDirs.push(dir);
  return dir;
}

function createCountingVfs(input: {
  node: VfsNode;
  streamText: string;
}): VfsOperationCore & {
  node: VfsNode;
  streamText: string;
  readCount: number;
} {
  return {
    node: input.node,
    streamText: input.streamText,
    readCount: 0,
    async listChildren() {
      return { items: [] };
    },
    async getMetadata() {
      return this.node;
    },
    async createReadStream() {
      this.readCount += 1;
      return new ReadableStream<Uint8Array>({
        start: (controller) => {
          controller.enqueue(new TextEncoder().encode(this.streamText));
          controller.close();
        },
      });
    },
  };
}

function createNode(
  input: Partial<VfsNode> & Pick<VfsNode, "nodeId" | "mountId">,
): VfsNode {
  return {
    nodeId: input.nodeId,
    mountId: input.mountId,
    parentId: input.parentId ?? null,
    name: input.name ?? "file.txt",
    kind: input.kind ?? "file",
    size: input.size ?? 12,
    mtimeMs: input.mtimeMs ?? 123,
    sourceRef: input.sourceRef ?? "docs/file.txt",
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
