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
  test("watch emits add/delete for mount node changes", async () => {
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

    expect(events.some((event) => event.type === "add")).toBe(true);
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
});
