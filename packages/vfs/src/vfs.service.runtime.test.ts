import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { container as rootContainer } from "tsyringe";
import { createVfsProviderRegistry } from "./vfs.provider.registry";
import type { VfsProviderAdapter } from "./vfs.provider.types";
import { createVfsRepository } from "./vfs.repository";
import { createVfsService } from "./vfs.service";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-runtime-"));
  const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
  const registry = createVfsProviderRegistry(rootContainer.createChildContainer());
  const service = createVfsService({
    repository: repo,
    registry,
    nowMs: () => 1_000,
    contentRootParent: join(dir, "content"),
  });
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

describe("vfs service runtime", () => {
  test("watch emits delete for mount/unmount sequence", async () => {
    const ctx = setup();
    const events: Array<{ type: string; id: string; parentId: string | null }> = [];
    const watcher = await ctx.service.watch({
      onEvent: (event) => events.push(event),
    });
    const mount = await ctx.service.mount({
      providerType: "mock-runtime",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });

    await ctx.service.unmount(mount.mountId);
    await Bun.sleep(80);

    expect(events.some((event) => event.type === "delete")).toBe(true);
    await watcher.close();
    await ctx.service.close();
    ctx.cleanup();
  });

  test("start manages syncers for existing and future mounts; close stops all", async () => {
    const ctx = setup();
    let starts = 0;
    let stops = 0;
    const adapter: VfsProviderAdapter = {
      type: "mock-watch-runtime",
      capabilities: { watch: true },
      async listChildren() {
        return { items: [] };
      },
      async watch() {
        starts += 1;
        return {
          close: async () => {
            stops += 1;
          },
        };
      },
    };
    ctx.registry.register(adapter.type, () => adapter);

    const m1 = await ctx.service.mount({
      providerType: adapter.type,
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });

    await ctx.service.start();
    expect(starts).toBe(1);

    const m2 = await ctx.service.mount({
      providerType: adapter.type,
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });
    expect(starts).toBe(2);

    await ctx.service.unmount(m1.mountId);
    expect(stops).toBe(1);

    await ctx.service.close();
    expect(stops).toBe(2);

    void m2;
    ctx.cleanup();
  });

  test("start schedules reconcile timer based on mount config", async () => {
    const ctx = setup();
    let listCalls = 0;
    ctx.registry.register("mock-reconcile-runtime", () => ({
      type: "mock-reconcile-runtime",
      capabilities: { watch: false },
      async listChildren() {
        listCalls += 1;
        return { items: [] };
      },
    }));

    await ctx.service.mount({
      providerType: "mock-reconcile-runtime",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 20,
    });

    await ctx.service.start();
    const afterStart = listCalls;
    await Bun.sleep(70);
    expect(listCalls).toBeGreaterThan(afterStart);

    await ctx.service.close();
    ctx.cleanup();
  });

  test("start continues when one mount fullSync fails", async () => {
    const ctx = setup();
    ctx.registry.register("mock-fail-start", () => ({
      type: "mock-fail-start",
      capabilities: { watch: false },
      async listChildren() {
        throw new Error("sync failed");
      },
    }));
    ctx.registry.register("mock-ok-start", () => ({
      type: "mock-ok-start",
      capabilities: { watch: false },
      async listChildren() {
        return { items: [] };
      },
    }));

    await ctx.service.mount({
      providerType: "mock-fail-start",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 20,
    });
    await ctx.service.mount({
      providerType: "mock-ok-start",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 20,
    });

    await expect(ctx.service.start()).resolves.toBeUndefined();
    await ctx.service.close();
    ctx.cleanup();
  });

  test("start does not wait for initial fullSync completion", async () => {
    const ctx = setup();
    ctx.registry.register("mock-slow-start", () => ({
      type: "mock-slow-start",
      capabilities: { watch: false },
      async listChildren() {
        await Bun.sleep(80);
        return { items: [] };
      },
    }));

    await ctx.service.mount({
      providerType: "mock-slow-start",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });

    const startPromise = ctx.service.start().then(() => true);
    const settledQuickly = await Promise.race([
      startPromise,
      Bun.sleep(20).then(() => false),
    ]);
    expect(settledQuickly).toBe(true);

    await ctx.service.close();
    ctx.cleanup();
  });

  test("autoSync=false: start does not watch/fullSync/reconcile", async () => {
    const ctx = setup();
    let starts = 0;
    let listCalls = 0;
    ctx.registry.register("mock-auto-sync-off", () => ({
      type: "mock-auto-sync-off",
      capabilities: { watch: true },
      async listChildren() {
        listCalls += 1;
        return { items: [] };
      },
      async watch() {
        starts += 1;
        return {
          close: async () => {},
        };
      },
    }));

    await ctx.service.mount({
      providerType: "mock-auto-sync-off",
      providerExtra: {},
      autoSync: false,
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 20,
    });

    await ctx.service.start();
    await Bun.sleep(80);

    expect(starts).toBe(0);
    expect(listCalls).toBe(0);

    await ctx.service.close();
    ctx.cleanup();
  });

  test("watch emits unified update event with contentUpdated/metadataChanged flags", async () => {
    const ctx = setup();
    const events: Array<{
      type: string;
      id: string;
      parentId: string | null;
      contentUpdated?: boolean;
      metadataChanged?: boolean;
    }> = [];
    const watcher = await ctx.service.watch({
      onEvent: (event) => events.push(event),
    });
    const mount = await ctx.service.mount({
      providerType: "mock-runtime",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });
    const mountNode = ctx.repo
      .listNodesByMountId(mount.mountId)
      .find((node) => node.kind === "mount");
    expect(mountNode).toBeDefined();

    ctx.repo.upsertNodes([
      {
        nodeId: "file-1",
        mountId: mount.mountId,
        parentId: mountNode!.nodeId,
        name: "old.txt",
        kind: "file",
        size: 1,
        mtimeMs: 1,
        sourceRef: "old.txt",
        providerVersion: "v1",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);
    ctx.repo.upsertNodes([
      {
        nodeId: "file-1",
        mountId: mount.mountId,
        parentId: mountNode!.nodeId,
        name: "new.txt",
        kind: "file",
        size: 2,
        mtimeMs: 2,
        sourceRef: "old.txt",
        providerVersion: "v2",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    ]);

    await Bun.sleep(180);
    const updateEvents = events.filter((event) => event.id === "file-1" && event.type === "update");
    expect(updateEvents.length).toBeGreaterThanOrEqual(2);
    expect(
      updateEvents.some(
        (event) => event.metadataChanged === true && event.contentUpdated === false,
      ),
    ).toBe(true);
    expect(
      updateEvents.some(
        (event) => event.metadataChanged === false && event.contentUpdated === true,
      ),
    ).toBe(true);

    await watcher.close();
    await ctx.service.close();
    ctx.cleanup();
  });

  test("local mount change semantics: add=true/true and update=true/true", async () => {
    const ctx = setup();
    const events: Array<{
      type: string;
      id: string;
      parentId: string | null;
      contentUpdated: boolean | null;
      metadataChanged: boolean | null;
    }> = [];
    const watcher = await ctx.service.watch({
      onEvent: (event) => events.push(event),
    });
    const mount = await ctx.service.mount({
      providerType: "local",
      providerExtra: { directory: ctx.dir },
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });
    const mountNode = ctx.repo
      .listNodesByMountId(mount.mountId)
      .find((node) => node.kind === "mount");
    expect(mountNode).toBeDefined();

    ctx.repo.upsertNodes([
      {
        nodeId: "local-file-1",
        mountId: mount.mountId,
        parentId: mountNode!.nodeId,
        name: "a.txt",
        kind: "file",
        size: 1,
        mtimeMs: 1,
        sourceRef: "a.txt",
        providerVersion: "v1",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);
    await Bun.sleep(30);
    ctx.repo.upsertNodes([
      {
        nodeId: "local-file-1",
        mountId: mount.mountId,
        parentId: mountNode!.nodeId,
        name: "a.txt",
        kind: "file",
        size: 2,
        mtimeMs: 2,
        sourceRef: "a.txt",
        providerVersion: "v2",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    ]);

    await Bun.sleep(180);

    const fileEvents = events.filter((event) => event.id === "local-file-1");
    expect(fileEvents.length).toBeGreaterThanOrEqual(2);
    expect(
      fileEvents.some(
        (event) => event.type === "add" && event.metadataChanged === true && event.contentUpdated === true,
      ),
    ).toBe(true);
    expect(
      fileEvents.some(
        (event) => event.type === "update" && event.metadataChanged === true && event.contentUpdated === false,
      ),
    ).toBe(true);
    expect(
      fileEvents.some(
        (event) => event.type === "update" && event.metadataChanged === false && event.contentUpdated === true,
      ),
    ).toBe(true);
    expect(
      fileEvents.every(
        (event) =>
          (event.type === "add" &&
            event.metadataChanged === true &&
            event.contentUpdated === true) ||
          (event.type === "update" &&
            ((event.metadataChanged === true && event.contentUpdated === false) ||
              (event.metadataChanged === false && event.contentUpdated === true))),
      ),
    ).toBe(true);

    await watcher.close();
    await ctx.service.close();
    ctx.cleanup();
  });

  test("content-only updates are debounced while metadata updates are fast", async () => {
    const ctx = setup();
    const events: Array<{
      type: string;
      id: string;
      parentId: string | null;
      contentUpdated: boolean | null;
      metadataChanged: boolean | null;
    }> = [];
    const watcher = await ctx.service.watch({
      onEvent: (event) => events.push(event),
    });
    const mount = await ctx.service.mount({
      providerType: "mock-runtime",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });
    const mountNode = ctx.repo
      .listNodesByMountId(mount.mountId)
      .find((node) => node.kind === "mount");
    expect(mountNode).toBeDefined();

    ctx.repo.upsertNodes([
      {
        nodeId: "debounce-file-1",
        mountId: mount.mountId,
        parentId: mountNode!.nodeId,
        name: "a.txt",
        kind: "file",
        size: 1,
        mtimeMs: 1,
        sourceRef: "a.txt",
        providerVersion: "v1",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);
    await Bun.sleep(40);
    events.length = 0;

    ctx.repo.upsertNodes([
      {
        nodeId: "debounce-file-1",
        mountId: mount.mountId,
        parentId: mountNode!.nodeId,
        name: "a.txt",
        kind: "file",
        size: 2,
        mtimeMs: 2,
        sourceRef: "a.txt",
        providerVersion: "v2",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    ]);
    await Bun.sleep(70);
    expect(events).toEqual([]);
    await Bun.sleep(90);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "update",
      id: "debounce-file-1",
      metadataChanged: false,
      contentUpdated: true,
    });

    await watcher.close();
    await ctx.service.close();
    ctx.cleanup();
  });
});
