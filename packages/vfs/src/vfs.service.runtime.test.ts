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

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return true;
    }
    await Bun.sleep(20);
  }
  return predicate();
}

describe("vfs service runtime", () => {
  test("registerNodeEventHooks exists and returns unsubscribe", () => {
    const ctx = setup();
    const off = ctx.service.registerNodeEventHooks({});

    expect(typeof ctx.service.registerNodeEventHooks).toBe("function");
    expect(typeof off).toBe("function");

    off();
    ctx.cleanup();
  });

  test("registerNodeEventHooks runs in order and applies to newly created syncers", async () => {
    const ctx = setup();
    const filesByMountId = new Map<string, string[]>();
    const calls: string[] = [];
    ctx.registry.register("mock-hook-runtime", (_container, mount) => ({
      type: "mock-hook-runtime",
      capabilities: { watch: false },
      async listChildren() {
        return {
          items: (filesByMountId.get(mount.mountId) ?? []).map((sourceRef) => ({
            nodeId: sourceRef,
            mountId: mount.mountId,
            parentId: null,
            name: sourceRef,
            kind: "file" as const,
            size: 1,
            mtimeMs: 1,
            sourceRef,
            providerVersion: null,
            deletedAtMs: null,
            createdAtMs: 1,
            updatedAtMs: 1,
          })),
        };
      },
      async getMetadata(input) {
        return {
          nodeId: input.id,
          mountId: mount.mountId,
          parentId: null,
          name: input.id,
          kind: "file" as const,
          size: 1,
          mtimeMs: 1,
          sourceRef: input.id,
          providerVersion: null,
          deletedAtMs: null,
          createdAtMs: 1,
          updatedAtMs: 1,
        };
      },
    }));

    const offA = ctx.service.registerNodeEventHooks({
      beforeAdd(ctx) {
        calls.push(`a:${ctx.mount?.mountId ?? "null"}:${ctx.event.sourceRef}`);
      },
    });
    const offB = ctx.service.registerNodeEventHooks({
      beforeAdd(ctx) {
        calls.push(`b:${ctx.mount?.mountId ?? "null"}:${ctx.event.sourceRef}`);
      },
    });

    const mount1 = await ctx.service.mount({
      providerType: "mock-hook-runtime",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });
    filesByMountId.set(mount1.mountId, ["a.txt"]);
    await ctx.service.triggerReconcile(mount1.mountId);
    const firstProcessed = await waitUntil(() => calls.length === 2, 500);

    expect(firstProcessed).toBe(true);
    expect(calls).toEqual([`a:${mount1.mountId}:a.txt`, `b:${mount1.mountId}:a.txt`]);

    offB();

    const mount2 = await ctx.service.mount({
      providerType: "mock-hook-runtime",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });
    filesByMountId.set(mount2.mountId, ["b.txt"]);
    await ctx.service.triggerReconcile(mount2.mountId);
    const secondProcessed = await waitUntil(() => calls.length === 3, 500);

    expect(secondProcessed).toBe(true);
    expect(calls).toEqual([
      `a:${mount1.mountId}:a.txt`,
      `b:${mount1.mountId}:a.txt`,
      `a:${mount2.mountId}:b.txt`,
    ]);

    offA();
    await ctx.service.close();
    ctx.cleanup();
  });

  test("subscribeNodeChanges exposes repository node updates", async () => {
    const ctx = setup();
    const rows = [];
    const off = ctx.service.subscribeNodeChanges((row) => {
      rows.push(row);
    });

    await ctx.service.mountInternal("mount-1", {
      providerType: "mock-service-node-changes",
      providerExtra: {},
      syncMetadata: false,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        mountId: "mount-1",
        kind: "mount",
        parentId: null,
      })
    );

    off();
    ctx.cleanup();
  });

  test("triggerReconcile enqueues work and processors drain asynchronously", async () => {
    const ctx = setup();
    const filesByMountId = new Map<string, string[]>();
    let releaseHook: (() => void) | null = null;
    const hookBlocked = new Promise<void>((resolve) => {
      releaseHook = resolve;
    });
    ctx.registry.register("mock-async-reconcile", (_container, mount) => ({
      type: "mock-async-reconcile",
      capabilities: { watch: false },
      async listChildren() {
        return {
          items: (filesByMountId.get(mount.mountId) ?? []).map((sourceRef) => ({
            nodeId: sourceRef,
            mountId: mount.mountId,
            parentId: null,
            name: sourceRef,
            kind: "file" as const,
            size: 1,
            mtimeMs: 1,
            sourceRef,
            providerVersion: null,
            deletedAtMs: null,
            createdAtMs: 1,
            updatedAtMs: 1,
          })),
        };
      },
      async getMetadata(input) {
        return {
          nodeId: input.id,
          mountId: mount.mountId,
          parentId: null,
          name: input.id,
          kind: "file" as const,
          size: 1,
          mtimeMs: 1,
          sourceRef: input.id,
          providerVersion: null,
          deletedAtMs: null,
          createdAtMs: 1,
          updatedAtMs: 1,
        };
      },
    }));
    ctx.service.registerNodeEventHooks({
      async beforeAdd() {
        await hookBlocked;
      },
    });

    const mount = await ctx.service.mount({
      providerType: "mock-async-reconcile",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });
    await ctx.service.start();
    filesByMountId.set(mount.mountId, ["a.txt"]);

    const reconcilePromise = ctx.service.triggerReconcile(mount.mountId).then(() => true);
    const settledQuickly = await Promise.race([reconcilePromise, Bun.sleep(20).then(() => false)]);

    expect(settledQuickly).toBe(true);
    expect(ctx.repo.listNodeEvents().length).toBeGreaterThan(0);

    releaseHook?.();

    const drained = await waitUntil(() => ctx.repo.listNodeEvents().length === 0, 500);
    expect(drained).toBe(true);

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

  test("queued delete events still run after restart when mount config is gone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-runtime-unmount-restart-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    const registry = createVfsProviderRegistry(rootContainer.createChildContainer());
    const service = createVfsService({
      repository: repo,
      registry,
      nowMs: () => 1_000,
      contentRootParent: join(dir, "content"),
    });
    const calls: string[] = [];
    registry.register("mock-unmount-delete-hooks", (_container, mount) => ({
      type: "mock-unmount-delete-hooks",
      capabilities: { watch: false },
      async listChildren() {
        return {
          items: [
            {
              nodeId: "f.txt",
              mountId: mount.mountId,
              parentId: null,
              name: "f.txt",
              kind: "file" as const,
              size: 1,
              mtimeMs: 1,
              sourceRef: "f.txt",
              providerVersion: null,
              deletedAtMs: null,
              createdAtMs: 1,
              updatedAtMs: 1,
            },
          ],
        };
      },
      async getMetadata(input) {
        return {
          nodeId: input.id,
          mountId: mount.mountId,
          parentId: null,
          name: input.id,
          kind: "file" as const,
          size: 1,
          mtimeMs: 1,
          sourceRef: input.id,
          providerVersion: null,
          deletedAtMs: null,
          createdAtMs: 1,
          updatedAtMs: 1,
        };
      },
    }));

    service.registerNodeEventHooks({
      beforeDelete(hookCtx) {
        calls.push(`before:${hookCtx.mount?.mountId ?? "null"}:${hookCtx.event.sourceRef}`);
      },
      afterDelete(hookCtx) {
        calls.push(`after:${hookCtx.mount?.mountId ?? "null"}:${hookCtx.event.sourceRef}`);
      },
    });

    const mount = await service.mount({
      providerType: "mock-unmount-delete-hooks",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    });

    await service.start();
    await service.triggerReconcile(mount.mountId);
    const indexed = await waitUntil(
      () => repo.listNodesByMountIdAndSourceRef(mount.mountId, "f.txt")?.deletedAtMs === null,
      500
    );

    expect(indexed).toBe(true);
    expect(repo.listNodesByMountIdAndSourceRef(mount.mountId, "f.txt")?.deletedAtMs).toBeNull();

    await service.close();
    repo.insertNodeEvents([
      {
        sourceRef: "f.txt",
        mountId: mount.mountId,
        parentId: null,
        type: "delete",
        node: null,
        createdAtMs: 1_001,
      },
    ]);
    repo.deleteNodeMountExtByMountId(mount.mountId);

    const restarted = createVfsService({
      repository: repo,
      registry,
      nowMs: () => 1_000,
      contentRootParent: join(dir, "content"),
    });
    restarted.registerNodeEventHooks({
      beforeDelete(hookCtx) {
        calls.push(`restart-before:${hookCtx.mount?.mountId ?? "null"}:${hookCtx.event.sourceRef}`);
      },
      afterDelete(hookCtx) {
        calls.push(`restart-after:${hookCtx.mount?.mountId ?? "null"}:${hookCtx.event.sourceRef}`);
      },
    });
    await restarted.start();

    const drained = await waitUntil(() => repo.listNodeEvents().length === 0, 500);

    expect(drained).toBe(true);
    expect(calls).toContain("restart-before:null:f.txt");
    expect(calls).toContain("restart-after:null:f.txt");

    await restarted.close();
    repo.close();
    rmSync(dir, { recursive: true, force: true });
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
    const settledQuickly = await Promise.race([startPromise, Bun.sleep(20).then(() => false)]);
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
});
