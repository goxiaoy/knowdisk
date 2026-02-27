import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeVfsCursorToken } from "./vfs.cursor";
import { createVfsProviderRegistry } from "./vfs.provider.registry";
import { createVfsRepository } from "./vfs.repository";
import { createVfsService } from "./vfs.service";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-integration-"));
  const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
  const registry = createVfsProviderRegistry();
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
    await ctx.service.mount({
      mountId: "m-local",
      mountPath: "/abc/local",
      providerType: "local",
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
    });
    ctx.repo.upsertNodes([
      {
        nodeId: "n1",
        mountId: "m-local",
        parentId: null,
        name: "a.md",
        vpath: "/abc/local/a.md",
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
        mountId: "m-local",
        parentId: null,
        name: "b.md",
        vpath: "/abc/local/b.md",
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

    const page = await ctx.service.walkChildren({ path: "/abc/local", limit: 10 });
    expect(page.source).toBe("local");
    expect(page.items.map((item) => item.name)).toEqual(["a.md", "b.md"]);

    ctx.cleanup();
  });

  test("mount remote mock provider and page children via remote cursor", async () => {
    const ctx = setup();
    let calls = 0;
    ctx.registry.register({
      type: "mock-remote",
      capabilities: { watch: false },
      async listChildren(input) {
        calls += 1;
        if (!input.cursor) {
          return {
            items: [
              {
                sourceRef: "r1",
                parentSourceRef: null,
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
              sourceRef: "r2",
              parentSourceRef: null,
              name: "r2.md",
              kind: "file",
              providerVersion: "rv2",
            },
          ],
        };
      },
    });

    await ctx.service.mount({
      mountId: "m-remote",
      mountPath: "/abc/drive",
      providerType: "mock-remote",
      syncMetadata: false,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
    });

    const page1 = await ctx.service.walkChildren({ path: "/abc/drive", limit: 1 });
    const page2 = await ctx.service.walkChildren({
      path: "/abc/drive",
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
    await ctx.service.mount({
      mountId: "m",
      mountPath: "/abc/m",
      providerType: "mock",
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
    });
    await expect(ctx.service.triggerReconcile("m")).resolves.toBeUndefined();
    ctx.cleanup();
  });
});
