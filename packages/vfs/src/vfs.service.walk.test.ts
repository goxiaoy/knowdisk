import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { container as rootContainer } from "tsyringe";
import { decodeVfsCursorToken } from "./vfs.cursor";
import { createVfsProviderRegistry } from "./vfs.provider.registry";
import { createVfsRepository } from "./vfs.repository";
import { createVfsService } from "./vfs.service";
import type { VfsProviderAdapter } from "./vfs.provider.types";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-service-"));
  const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
  const registry = createVfsProviderRegistry(rootContainer.createChildContainer());
  let nowMs = 1_000;
  const service = createVfsService({
    repository: repo,
    registry,
    nowMs: () => nowMs,
  });
  return {
    dir,
    repo,
    registry,
    service,
    setNowMs(value: number) {
      nowMs = value;
    },
    cleanup() {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("vfs service walkChildren", () => {
  test("returns local page results and local cursor", async () => {
    const ctx = setup();
    const mount = await ctx.service.mount({
      providerType: "mock-local",
      providerExtra: {},
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });

    const roots = await ctx.service.walkChildren({ parentNodeId: null, limit: 10 });
    const mountNode = roots.items.find(
      (item) => item.kind === "mount" && item.mountId === mount.mountId
    );
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

    const pageChildren1 = await ctx.service.walkChildren({
      parentNodeId: mountNode!.nodeId,
      limit: 1,
    });
    expect(pageChildren1.source).toBe("local");
    expect(pageChildren1.items.map((item) => item.nodeId)).toEqual(["n1"]);
    expect(pageChildren1.nextCursor?.mode).toBe("local");

    const page2 = await ctx.service.walkChildren({
      parentNodeId: mountNode!.nodeId,
      limit: 10,
      cursor: pageChildren1.nextCursor,
    });
    expect(page2.items.map((item) => item.nodeId)).toEqual(["n2"]);

    ctx.cleanup();
  });

  test("unsynced mount returns empty local results without querying the provider", async () => {
    const ctx = setup();
    let called = 0;
    const adapter: VfsProviderAdapter = {
      type: "mock-remote",
      capabilities: { watch: false },
      async listChildren() {
        called += 1;
        return {
          items: [
            {
              id: "remote-1",
              parentId: null,
              name: "remote.md",
              kind: "file",
              size: 5,
              mtimeMs: 5,
              providerVersion: "rv1",
            },
          ],
          nextCursor: "provider-next",
        };
      },
    };
    ctx.registry.register(adapter.type, () => adapter);

    const mount = await ctx.service.mount({
      providerType: "mock-remote",
      providerExtra: { token: "s3-token" },
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });

    const roots = await ctx.service.walkChildren({ parentNodeId: null, limit: 10 });
    const mountNode = roots.items.find(
      (item) => item.kind === "mount" && item.mountId === mount.mountId
    );
    expect(mountNode).toBeDefined();

    const page = await ctx.service.walkChildren({ parentNodeId: mountNode!.nodeId, limit: 10 });
    expect(called).toBe(0);
    expect(page.source).toBe("local");
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeUndefined();

    ctx.cleanup();
  });

  test("returns synced local rows for remote-backed mounts after metadata is stored", async () => {
    const ctx = setup();
    let called = 0;
    ctx.registry.register("mock-remote-cache", () => ({
      type: "mock-remote-cache",
      capabilities: { watch: false },
      async listChildren() {
        called += 1;
        return {
          items: [
            {
              id: "r1",
              parentId: null,
              name: "cached.md",
              kind: "file",
              providerVersion: "v1",
            },
          ],
          nextCursor: "cursor-1",
        };
      },
    }));

    const mount = await ctx.service.mount({
      providerType: "mock-remote-cache",
      providerExtra: {},
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });

    const roots = await ctx.service.walkChildren({ parentNodeId: null, limit: 10 });
    const mountNode = roots.items.find(
      (item) => item.kind === "mount" && item.mountId === mount.mountId
    );
    expect(mountNode).toBeDefined();

    ctx.repo.upsertNodes([
      {
        nodeId: "remote-row-1",
        mountId: mount.mountId,
        parentId: mountNode!.nodeId,
        name: "cached.md",
        kind: "file",
        size: 1,
        mtimeMs: 1,
        sourceRef: "r1",
        providerVersion: "v1",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);

    ctx.setNowMs(2_000);
    const page = await ctx.service.walkChildren({ parentNodeId: mountNode!.nodeId, limit: 10 });
    expect(called).toBe(0);
    expect(page.items.map((item) => item.sourceRef)).toEqual(["r1"]);

    ctx.cleanup();
  });

  test("walkChildren reads mount config from db on every call", async () => {
    const ctx = setup();
    let called = 0;
    const adapter: VfsProviderAdapter = {
      type: "mock-db-authoritative",
      capabilities: { watch: false },
      async listChildren() {
        called += 1;
        return { items: [] };
      },
    };
    ctx.registry.register(adapter.type, () => adapter);

    const mount = await ctx.service.mount({
      providerType: adapter.type,
      providerExtra: {},
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });

    const roots = await ctx.service.walkChildren({ parentNodeId: null, limit: 10 });
    const mountNode = roots.items.find(
      (item) => item.kind === "mount" && item.mountId === mount.mountId
    );
    expect(mountNode).toBeDefined();

    await ctx.service.walkChildren({ parentNodeId: mountNode!.nodeId, limit: 10 });
    expect(called).toBe(0);

    const ext = ctx.repo.getNodeMountExtByMountId(mount.mountId);
    expect(ext).toBeDefined();
    ctx.repo.upsertNodeMountExt({
      ...ext!,
      updatedAtMs: 2_000,
    });
    ctx.repo.upsertNodes([
      {
        nodeId: "db-local-1",
        mountId: mount.mountId,
        parentId: mountNode!.nodeId,
        name: "local.txt",
        kind: "file",
        size: 1,
        mtimeMs: 1,
        sourceRef: "local.txt",
        providerVersion: null,
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);

    const page = await ctx.service.walkChildren({ parentNodeId: mountNode!.nodeId, limit: 10 });
    expect(page.source).toBe("local");
    expect(page.items.map((item) => item.nodeId)).toEqual(["db-local-1"]);
    expect(called).toBe(0);

    ctx.cleanup();
  });

  test("local cursor token still decodes after pagination", async () => {
    const ctx = setup();
    const mount = await ctx.service.mount({
      providerType: "mock-local-cursor",
      providerExtra: {},
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });
    const roots = await ctx.service.walkChildren({ parentNodeId: null, limit: 10 });
    const mountNode = roots.items.find(
      (item) => item.kind === "mount" && item.mountId === mount.mountId
    );
    expect(mountNode).toBeDefined();

    ctx.repo.upsertNodes([
      {
        nodeId: "cursor-1",
        mountId: mount.mountId,
        parentId: mountNode!.nodeId,
        name: "a.txt",
        kind: "file",
        size: 1,
        mtimeMs: 1,
        sourceRef: "a.txt",
        providerVersion: null,
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      {
        nodeId: "cursor-2",
        mountId: mount.mountId,
        parentId: mountNode!.nodeId,
        name: "b.txt",
        kind: "file",
        size: 1,
        mtimeMs: 1,
        sourceRef: "b.txt",
        providerVersion: null,
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);

    const first = await ctx.service.walkChildren({ parentNodeId: mountNode!.nodeId, limit: 1 });
    expect(first.nextCursor).toBeDefined();
    const decoded = decodeVfsCursorToken(first.nextCursor!.token);
    expect(decoded.mode).toBe("local");

    ctx.cleanup();
  });
});
