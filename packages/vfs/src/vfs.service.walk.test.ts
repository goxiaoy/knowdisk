import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { container as rootContainer } from "tsyringe";
import { decodeVfsCursorToken } from "./vfs.cursor";
import { decodeBase64UrlNodeIdToUuid } from "./vfs.node-id";
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
  test("syncMetadata=true: resolves local page and returns local cursor", async () => {
    const ctx = setup();
    const mount = await ctx.service.mount({
      providerType: "mock-local",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });

    const roots = await ctx.service.walkChildren({ parentNodeId: null, limit: 10 });
    const mountNode = roots.items.find(
      (item) => item.kind === "mount" && item.mountId === mount.mountId,
    );
    expect(mountNode).toBeDefined();

    ctx.repo.upsertNodes([
      {
        nodeId: "n1",
        mountId: mount.mountId,
        parentId: mountNode!.nodeId,
        name: "a.md",
        kind: "file",
        title: "A",
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
        title: "B",
        size: 2,
        mtimeMs: 2,
        sourceRef: "s2",
        providerVersion: "v2",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);

    const pageChildren1 = await ctx.service.walkChildren({ parentNodeId: mountNode!.nodeId, limit: 1 });
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

  test("syncMetadata=false: fetches provider page and backfills node/page cache", async () => {
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
              title: "Remote",
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
      syncMetadata: false,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });

    const roots = await ctx.service.walkChildren({ parentNodeId: null, limit: 10 });
    const mountNode = roots.items.find((item) => item.kind === "mount" && item.mountId === mount.mountId);
    expect(mountNode).toBeDefined();
    const page = await ctx.service.walkChildren({ parentNodeId: mountNode!.nodeId, limit: 10 });
    expect(called).toBe(1);
    expect(page.source).toBe("remote");
    expect(page.items.map((item) => item.sourceRef)).toEqual(["remote-1"]);
    expect(() => decodeBase64UrlNodeIdToUuid(page.items[0]!.nodeId)).not.toThrow();
    expect(page.nextCursor?.mode).toBe("remote");

    const local = ctx.repo.listChildrenPageLocal({
      mountId: mount.mountId,
      parentId: mountNode!.nodeId,
      limit: 10,
    });
    expect(local.items.map((item) => item.sourceRef)).toEqual(["remote-1"]);

    ctx.cleanup();
  });

  test("syncMetadata=false with fresh cached page and same cursor: returns cache hit", async () => {
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
              title: "Cached",
              providerVersion: "v1",
            },
          ],
          nextCursor: "cursor-1",
        };
      },
    }));

    await ctx.service.mount({
      providerType: "mock-remote-cache",
      providerExtra: {},
      syncMetadata: false,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });

    const roots = await ctx.service.walkChildren({ parentNodeId: null, limit: 10 });
    const mountNode = roots.items.find((item) => item.kind === "mount");
    expect(mountNode).toBeDefined();
    const first = await ctx.service.walkChildren({ parentNodeId: mountNode!.nodeId, limit: 10 });
    expect(called).toBe(1);
    expect(first.items).toHaveLength(1);

    ctx.setNowMs(2_000);
    const second = await ctx.service.walkChildren({ parentNodeId: mountNode!.nodeId, limit: 10 });
    expect(called).toBe(1);
    expect(second.items.map((item) => item.sourceRef)).toEqual(["r1"]);

    const decoded = decodeVfsCursorToken(second.nextCursor!.token);
    expect(decoded).toEqual({ mode: "remote", providerCursor: "cursor-1" });

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
      syncMetadata: false,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });

    const roots = await ctx.service.walkChildren({ parentNodeId: null, limit: 10 });
    const mountNode = roots.items.find((item) => item.kind === "mount" && item.mountId === mount.mountId);
    expect(mountNode).toBeDefined();

    await ctx.service.walkChildren({ parentNodeId: mountNode!.nodeId, limit: 10 });
    expect(called).toBe(1);

    const ext = ctx.repo.getNodeMountExtByMountId(mount.mountId);
    expect(ext).toBeDefined();
    ctx.repo.upsertNodeMountExt({
      ...ext!,
      syncMetadata: true,
      updatedAtMs: 2_000,
    });
    ctx.repo.upsertNodes([
      {
        nodeId: "db-local-1",
        mountId: mount.mountId,
        parentId: mountNode!.nodeId,
        name: "local.txt",
        kind: "file",
        title: "local.txt",
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
    expect(called).toBe(1);

    ctx.cleanup();
  });

  test("syncMetadata=false passes core operation input keys (parentId)", async () => {
    const ctx = setup();
    let seenParentId: string | null | undefined;
    ctx.registry.register("mock-core-keys", () => ({
      type: "mock-core-keys",
      capabilities: { watch: false },
      async listChildren(input) {
        seenParentId = input.parentId;
        return { items: [] };
      },
    }));

    const mount = await ctx.service.mount({
      providerType: "mock-core-keys",
      providerExtra: {},
      syncMetadata: false,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });
    const roots = await ctx.service.walkChildren({ parentNodeId: null, limit: 10 });
    const mountNode = roots.items.find((item) => item.kind === "mount" && item.mountId === mount.mountId);
    expect(mountNode).toBeDefined();

    await ctx.service.walkChildren({ parentNodeId: mountNode!.nodeId, limit: 10 });
    expect(seenParentId).toBeNull();

    ctx.cleanup();
  });
});
