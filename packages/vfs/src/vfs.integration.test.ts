import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { container as rootContainer } from "tsyringe";
import { decodeVfsCursorToken } from "./vfs.cursor";
import { createVfsProviderRegistry } from "./vfs.provider.registry";
import { createVfsRepository } from "./vfs.repository";
import { createVfsService } from "./vfs.service";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-integration-"));
  const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
  const registry = createVfsProviderRegistry(rootContainer.createChildContainer());
  const service = createVfsService({ repository: repo, registry, nowMs: () => 1_000 });
  return {
    dir,
    repo,
    registry,
    service,
    cleanup() {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("vfs integration", () => {
  test("mount local folder and page children from metadata", async () => {
    const ctx = setup();
    const mount = await ctx.service.mount({
      providerType: "local",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
    });
    const roots = await ctx.service.walkChildren({ parentNodeId: null, limit: 20 });
    const mountNode = roots.items.find((item) => item.kind === "mount" && item.mountId === mount.mountId);
    expect(mountNode).toBeDefined();
    ctx.repo.upsertNodes([
      {
        nodeId: "n1",
        mountId: mount.mountId,
        parentId: mountNode!.nodeId,
        name: "a.md",
        kind: "file",
        size: 1,
        mtimeMs: 1,
        sourceRef: "s1",
        providerVersion: "v1",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      {
        nodeId: "n2",
        mountId: mount.mountId,
        parentId: mountNode!.nodeId,
        name: "b.md",
        kind: "file",
        size: 2,
        mtimeMs: 2,
        sourceRef: "s2",
        providerVersion: "v2",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);

    const page = await ctx.service.walkChildren({ parentNodeId: mountNode!.nodeId, limit: 10 });
    expect(page.source).toBe("local");
    expect(page.items.map((item) => item.name)).toEqual(["a.md", "b.md"]);

    ctx.cleanup();
  });

  test("mount remote mock provider and page children via remote cursor", async () => {
    const ctx = setup();
    let calls = 0;
    ctx.registry.register("mock-remote", () => ({
      type: "mock-remote",
      capabilities: { watch: false },
      async listChildren(input) {
        calls += 1;
        if (!input.cursor) {
          return {
            items: [
              {
                id: "r1",
                parentId: null,
                name: "r1.md",
                kind: "file",
                providerVersion: "rv1",
              },
            ],
            nextCursor: "p2",
          };
        }
        return {
          items: [
            {
              id: "r2",
              parentId: null,
              name: "r2.md",
              kind: "file",
              providerVersion: "rv2",
            },
          ],
        };
      },
    }));

    await ctx.service.mount({
      providerType: "mock-remote",
      providerExtra: { token: "remote-token" },
      syncMetadata: false,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
    });

    const roots = await ctx.service.walkChildren({ parentNodeId: null, limit: 10 });
    const mountNode = roots.items.find((item) => item.kind === "mount");
    expect(mountNode).toBeDefined();
    const page1 = await ctx.service.walkChildren({ parentNodeId: mountNode!.nodeId, limit: 1 });
    const page2 = await ctx.service.walkChildren({
      parentNodeId: mountNode!.nodeId,
      limit: 1,
      cursor: page1.nextCursor,
    });

    expect(calls).toBe(2);
    expect(page1.source).toBe("remote");
    expect(page1.items.map((item) => item.sourceRef)).toEqual(["r1"]);
    expect(page2.items.map((item) => item.sourceRef)).toEqual(["r2"]);

    const cursorPayload = decodeVfsCursorToken(page1.nextCursor!.token);
    expect(cursorPayload).toEqual({ mode: "remote", providerCursor: "p2" });

    ctx.cleanup();
  });

  test("triggerReconcile is callable", async () => {
    const ctx = setup();
    const mount = await ctx.service.mount({
      providerType: "mock",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
    });
    await expect(ctx.service.triggerReconcile(mount.mountId)).resolves.toBeUndefined();
    ctx.cleanup();
  });

  test("mountInternal uses explicit mountId", async () => {
    const ctx = setup();
    const mount = await ctx.service.mountInternal("explicit-id", {
      providerType: "mock",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
    });
    expect(mount.mountId).toBe("explicit-id");
    ctx.cleanup();
  });

  test("service getVersion reads providerVersion from metadata db", async () => {
    const ctx = setup();
    const mount = await ctx.service.mount({
      providerType: "mock",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
    });
    const roots = await ctx.service.walkChildren({ parentNodeId: null, limit: 10 });
    const mountNode = roots.items.find((item) => item.kind === "mount" && item.mountId === mount.mountId);
    expect(mountNode).toBeDefined();
    ctx.repo.upsertNodes([
      {
        nodeId: "version-node",
        mountId: mount.mountId,
        parentId: mountNode!.nodeId,
        name: "v.txt",
        kind: "file",
        size: 1,
        mtimeMs: 1,
        sourceRef: "v.txt",
        providerVersion: "db-version",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);
    await expect(ctx.service.getVersion?.({ id: "version-node" })).resolves.toBe("db-version");
    await expect(ctx.service.getVersion?.({ id: "missing-node" })).resolves.toBeNull();
    ctx.cleanup();
  });

  test("service create/rename/delete routes to provider operations", async () => {
    const ctx = setup();
    const calls: Array<{ op: string; id?: string | null; name?: string }> = [];
    ctx.registry.register("mock-mutate", () => ({
      type: "mock-mutate",
      capabilities: { watch: false },
      async listChildren() {
        return { items: [] };
      },
      async create(input) {
        calls.push({ op: "create", id: input.parentId, name: input.name });
        return {
          nodeId: "created.txt",
          mountId: "ignored",
          parentId: input.parentId,
          name: input.name ?? "created.txt",
          kind: "file",
          size: 0,
          mtimeMs: 1,
          sourceRef: "created.txt",
          providerVersion: null,
          deletedAtMs: null,
          createdAtMs: 0,
          updatedAtMs: 0,
        };
      },
      async rename(input) {
        calls.push({ op: "rename", id: input.id, name: input.name });
        return {
          nodeId: input.name,
          mountId: "ignored",
          parentId: null,
          name: input.name,
          kind: "file",
          size: 0,
          mtimeMs: 1,
          sourceRef: input.name,
          providerVersion: null,
          deletedAtMs: null,
          createdAtMs: 0,
          updatedAtMs: 0,
        };
      },
      async delete(input) {
        calls.push({ op: "delete", id: input.id });
      },
    }));

    const mount = await ctx.service.mount({
      providerType: "mock-mutate",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
    });
    const roots = await ctx.service.walkChildren({ parentNodeId: null, limit: 10 });
    const mountNode = roots.items.find((item) => item.kind === "mount" && item.mountId === mount.mountId);
    expect(mountNode).toBeDefined();

    const created = await ctx.service.create({
      parentId: mountNode!.nodeId,
      name: "custom-name.txt",
    });
    expect(created.name).toBe("custom-name.txt");

    const renamed = await ctx.service.rename({
      id: created.nodeId,
      name: "renamed.txt",
    });
    expect(renamed.name).toBe("renamed.txt");

    await ctx.service.delete({ id: renamed.nodeId });
    expect(calls.map((item) => item.op)).toEqual(["create", "rename", "delete"]);
    expect(calls[0]?.id).toBeNull();
    expect(calls[0]?.name).toBe("custom-name.txt");

    ctx.cleanup();
  });

  test("service createReadStream reads from local content when syncContent is enabled", async () => {
    const ctx = setup();
    const contentRootParent = join(ctx.dir, "content");
    mkdirSync(contentRootParent, { recursive: true });
    const service = createVfsService({
      repository: ctx.repo,
      registry: ctx.registry,
      nowMs: () => 1_000,
      contentRootParent,
    });
    const mount = await ctx.service.mount({
      providerType: "mock",
      providerExtra: {},
      syncMetadata: true,
      syncContent: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
    });
    const roots = await ctx.service.walkChildren({ parentNodeId: null, limit: 10 });
    const mountNode = roots.items.find((item) => item.kind === "mount" && item.mountId === mount.mountId);
    expect(mountNode).toBeDefined();
    ctx.repo.upsertNodes([
      {
        nodeId: "content-node",
        mountId: mount.mountId,
        parentId: mountNode!.nodeId,
        name: "a.txt",
        kind: "file",
        size: 5,
        mtimeMs: 1,
        sourceRef: "a.txt",
        providerVersion: "v1",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);
    mkdirSync(join(contentRootParent, mount.mountId), { recursive: true });
    writeFileSync(join(contentRootParent, mount.mountId, "a.txt"), "hello", {
      encoding: "utf8",
    });

    const stream = await service.createReadStream?.({ id: "content-node" });
    const text = await new Response(stream).text();

    expect(text).toBe("hello");
    ctx.cleanup();
  });

  test("service createReadStream delegates to provider when syncContent is disabled", async () => {
    const ctx = setup();
    const service = createVfsService({
      repository: ctx.repo,
      registry: ctx.registry,
      nowMs: () => 1_000,
      contentRootParent: join(ctx.dir, "content"),
    });
    let calls = 0;
    ctx.registry.register("mock-stream", () => ({
      type: "mock-stream",
      capabilities: { watch: false },
      async listChildren() {
        return { items: [] };
      },
      async getMetadata(input) {
        return {
          nodeId: input.id,
          mountId: "ignored",
          parentId: null,
          name: input.id,
          kind: "file",
          size: 5,
          mtimeMs: 1,
          sourceRef: input.id,
          providerVersion: null,
          deletedAtMs: null,
          createdAtMs: 0,
          updatedAtMs: 0,
        };
      },
      async createReadStream(input) {
        calls += 1;
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`${input.id}:${input.offset ?? 0}`));
            controller.close();
          },
        });
      },
    }));
    const mount = await ctx.service.mount({
      providerType: "mock-stream",
      providerExtra: {},
      syncMetadata: true,
      syncContent: false,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
    });
    const roots = await ctx.service.walkChildren({ parentNodeId: null, limit: 10 });
    const mountNode = roots.items.find((item) => item.kind === "mount" && item.mountId === mount.mountId);
    expect(mountNode).toBeDefined();
    ctx.repo.upsertNodes([
      {
        nodeId: "remote-stream-node",
        mountId: mount.mountId,
        parentId: mountNode!.nodeId,
        name: "a.txt",
        kind: "file",
        size: 5,
        mtimeMs: 1,
        sourceRef: "a.txt",
        providerVersion: "v1",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);

    const stream = await service.createReadStream?.({
      id: "remote-stream-node",
      offset: 2,
    });
    const text = await new Response(stream).text();

    expect(text).toBe("a.txt:2");
    expect(calls).toBe(1);
    ctx.cleanup();
  });
});
