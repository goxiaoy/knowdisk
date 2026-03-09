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
      }),
    );

    off();
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

});
