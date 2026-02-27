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
  test("syncMetadata=true: resolves local page and returns local cursor", async () => {
    const ctx = setup();
    const mount = await ctx.service.mount({
      mountPath: "/abc/drive",
      providerType: "mock-local",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });

    ctx.repo.upsertNodes([
      {
        nodeId: "n1",
        mountId: mount.mountId,
        parentId: null,
        name: "a.md",
        vpath: "/abc/drive/a.md",
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
        parentId: null,
        name: "b.md",
        vpath: "/abc/drive/b.md",
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

    const page1 = await ctx.service.walkChildren({ path: "/abc/drive", limit: 1 });
    expect(page1.source).toBe("local");
    expect(page1.items.map((item) => item.nodeId)).toEqual(["n1"]);
    expect(page1.nextCursor?.mode).toBe("local");

    const page2 = await ctx.service.walkChildren({
      path: "/abc/drive",
      limit: 10,
      cursor: page1.nextCursor,
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
              sourceRef: "remote-1",
              parentSourceRef: null,
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
      mountPath: "/abc/s3",
      providerType: "mock-remote",
      providerExtra: { token: "s3-token" },
      syncMetadata: false,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });

    const page = await ctx.service.walkChildren({ path: "/abc/s3", limit: 10 });
    expect(called).toBe(1);
    expect(page.source).toBe("remote");
    expect(page.items.map((item) => item.sourceRef)).toEqual(["remote-1"]);
    expect(page.nextCursor?.mode).toBe("remote");

    const local = ctx.repo.listChildrenPageLocal({ mountId: mount.mountId, parentId: null, limit: 10 });
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
              sourceRef: "r1",
              parentSourceRef: null,
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
      mountPath: "/abc/cache",
      providerType: "mock-remote-cache",
      providerExtra: {},
      syncMetadata: false,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });

    const first = await ctx.service.walkChildren({ path: "/abc/cache", limit: 10 });
    expect(called).toBe(1);
    expect(first.items).toHaveLength(1);

    ctx.setNowMs(2_000);
    const second = await ctx.service.walkChildren({ path: "/abc/cache", limit: 10 });
    expect(called).toBe(1);
    expect(second.items.map((item) => item.sourceRef)).toEqual(["r1"]);

    const decoded = decodeVfsCursorToken(second.nextCursor!.token);
    expect(decoded).toEqual({ mode: "remote", providerCursor: "cursor-1" });

    ctx.cleanup();
  });
});
