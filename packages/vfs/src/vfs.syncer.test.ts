import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVfsNodeId, decodeBase64UrlNodeIdToUuid } from "./vfs.node-id";
import { createVfsRepository } from "./vfs.repository";
import { createVfsSyncer } from "./vfs.syncer";
import type { VfsProviderAdapter } from "./vfs.provider.types";
import type { VfsMount } from "./vfs.types";

function createMockLogger() {
  const records: Array<{ level: "info" | "warn" | "error" | "debug"; msg: string }> = [];
  return {
    logger: {
      info: (_obj: unknown, msg?: string) => records.push({ level: "info", msg: msg ?? "" }),
      warn: (_obj: unknown, msg?: string) => records.push({ level: "warn", msg: msg ?? "" }),
      error: (_obj: unknown, msg?: string) => records.push({ level: "error", msg: msg ?? "" }),
      debug: (_obj: unknown, msg?: string) => records.push({ level: "debug", msg: msg ?? "" }),
    },
    records,
  };
}

function makeMount(extra?: Partial<VfsMount>): VfsMount {
  return {
    mountId: "m1",
    providerType: "mock",
    providerExtra: {},
    syncMetadata: true,
    metadataTtlSec: 60,
    reconcileIntervalMs: 1000,
    ...extra,
  };
}

describe("vfs syncer", () => {
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

  test("fullSync reconciles metadata add/update/delete and enriches incomplete metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-meta-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const mount = makeMount();
      repo.upsertNodes([
        {
          nodeId: createVfsNodeId({
            mountId: mount.mountId,
            sourceRef: "legacy.txt",
          }),
          mountId: mount.mountId,
          parentId: null,
          name: "legacy.txt",
          kind: "file",
          size: 11,
          mtimeMs: 1,
          sourceRef: "legacy.txt",
          providerVersion: null,
          deletedAtMs: null,
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ]);

      const provider: VfsProviderAdapter = {
        type: "mock",
        capabilities: { watch: false },
        async listChildren(input) {
          if (input.parentSourceRef !== null) {
            return { items: [] };
          }
          return {
            items: [
              {
                sourceRef: "a.txt",
                parentSourceRef: null,
                name: "a.txt",
                kind: "file",
                size: 0,
              },
              {
                sourceRef: "b.txt",
                parentSourceRef: null,
                name: "b.txt",
                kind: "file",
                size: 2,
              },
            ],
          };
        },
        async getMetadata(input) {
          if (input.sourceRef === "a.txt") {
            return {
              sourceRef: "a.txt",
              parentSourceRef: null,
              name: "a.txt",
              kind: "file",
              size: 5,
            };
          }
          return null;
        },
      };

      const syncer = createVfsSyncer({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        nowMs: () => 1000,
      });
      const events: Array<{ type: string; payload: unknown }> = [];
      const off = syncer.subscribe((event) => events.push(event));
      await syncer.fullSync();
      off();

      const all = repo.listNodesByMountId(mount.mountId);
      const a = all.find((n) => n.sourceRef === "a.txt");
      const b = all.find((n) => n.sourceRef === "b.txt");
      const legacy = all.find((n) => n.sourceRef === "legacy.txt");
      expect(a?.size).toBe(5);
      expect(b?.size).toBe(2);
      expect(() => decodeBase64UrlNodeIdToUuid(a!.nodeId)).not.toThrow();
      expect(a?.parentId).toBeNull();
      expect(legacy?.deletedAtMs).toBe(1000);
      expect(events.some((e) => e.type === "status")).toBe(true);
      expect(events.some((e) => e.type === "metadata_progress")).toBe(true);
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fullSync resumes content download from .part file and emits download progress", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-content-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const mount = makeMount({ syncContent: true });
      const offsets: number[] = [];
      const provider: VfsProviderAdapter = {
        type: "mock",
        capabilities: { watch: false },
        async listChildren() {
          return {
            items: [
              {
                sourceRef: "f.txt",
                parentSourceRef: null,
                name: "f.txt",
                kind: "file",
                size: 6,
              },
            ],
          };
        },
        async createReadStream(input) {
          offsets.push(input.offset ?? 0);
          const content = "abcdef".slice(input.offset ?? 0);
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(content));
              controller.close();
            },
          });
        },
      };
      const contentParent = join(dir, "content");
      await mkdir(join(contentParent, mount.mountId), { recursive: true });
      writeFileSync(join(contentParent, mount.mountId, "f.txt.part"), "abc");

      const syncer = createVfsSyncer({
        mount,
        provider,
        repository: repo,
        contentRootParent: contentParent,
        nowMs: () => 2000,
      });
      const events: Array<{ type: string; payload: unknown }> = [];
      const off = syncer.subscribe((event) => events.push(event));
      await syncer.fullSync();
      off();

      expect(offsets).toEqual([3]);
      expect(readFileSync(join(contentParent, mount.mountId, "f.txt"), "utf8")).toBe("abcdef");
      expect(events.some((e) => e.type === "download_progress")).toBe(true);
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("watch change triggers getMetadata and auto syncContent; delete marks node deleted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-watch-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const mount = makeMount({ syncContent: true });
      repo.upsertNodes([
        {
          nodeId: createVfsNodeId({
            mountId: mount.mountId,
            sourceRef: "f.txt",
          }),
          mountId: mount.mountId,
          parentId: null,
          name: "f.txt",
          kind: "file",
          size: 3,
          mtimeMs: 1,
          sourceRef: "f.txt",
          providerVersion: "v1",
          deletedAtMs: null,
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ]);
      const contentParent = join(dir, "content");
      await mkdir(join(contentParent, mount.mountId), { recursive: true });
      writeFileSync(join(contentParent, mount.mountId, "f.txt.part"), "old-part");

      let watchHandler:
        | ((event: {
            type: "add" | "update_metadata" | "update_content" | "delete";
            sourceRef: string;
            parentSourceRef: string | null;
          }) => void)
        | null = null;
      const offsets: number[] = [];
      let metadataCalls = 0;
      const provider: VfsProviderAdapter = {
        type: "mock",
        capabilities: { watch: true },
        async listChildren() {
          return { items: [] };
        },
        async getMetadata(input) {
          metadataCalls += 1;
          if (input.sourceRef === "f.txt") {
            return {
              sourceRef: "f.txt",
              parentSourceRef: null,
              name: "f.txt",
              kind: "file",
              size: 3,
              providerVersion: "v2",
            };
          }
          return null;
        },
        async createReadStream(input) {
          offsets.push(input.offset ?? 0);
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("new"));
              controller.close();
            },
          });
        },
        async watch(input) {
          watchHandler = input.onEvent;
          return {
            close: async () => {
              watchHandler = null;
            },
          };
        },
      };

      const syncer = createVfsSyncer({
        mount,
        provider,
        repository: repo,
        contentRootParent: contentParent,
        nowMs: () => 3000,
      });
      await syncer.startWatching();
      watchHandler?.({
        type: "update_content",
        sourceRef: "f.txt",
        parentSourceRef: null,
      });
      const updated = await waitUntil(() => {
        const node = repo.listNodesByMountId(mount.mountId).find((n) => n.sourceRef === "f.txt");
        return node?.providerVersion === "v2";
      }, 2000);

      expect(updated).toBe(true);
      expect(metadataCalls).toBeGreaterThan(0);
      expect(offsets).toEqual([0]);
      expect(readFileSync(join(contentParent, mount.mountId, "f.txt"), "utf8")).toBe("new");

      watchHandler?.({
        type: "delete",
        sourceRef: "f.txt",
        parentSourceRef: null,
      });
      const deleted = await waitUntil(() => {
        const node = repo.listNodesByMountId(mount.mountId).find((n) => n.sourceRef === "f.txt");
        return (node?.deletedAtMs ?? null) !== null;
      }, 2000);
      expect(deleted).toBe(true);
      await syncer.stopWatching();
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fullSync logs status transitions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-logs-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const mount = makeMount();
      const provider: VfsProviderAdapter = {
        type: "mock",
        capabilities: { watch: false },
        async listChildren() {
          return { items: [] };
        },
      };
      const mock = createMockLogger();
      const syncer = createVfsSyncer({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        logger: mock.logger as never,
      });
      await syncer.fullSync();
      expect(
        mock.records.some(
          (record) => record.level === "info" && record.msg.includes("syncer status changed"),
        ),
      ).toBe(true);
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fullSync traverses children by provider node id instead of sourceRef", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-provider-id-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const mount = makeMount();
      const provider: VfsProviderAdapter = {
        type: "mock",
        capabilities: { watch: false },
        async listChildren(input) {
          if (input.parentId === null) {
            return {
              items: [
                {
                  nodeId: "folder-id",
                  mountId: mount.mountId,
                  parentId: null,
                  sourceRef: "dir",
                  name: "dir",
                  kind: "folder",
                  size: null,
                  mtimeMs: null,
                  providerVersion: null,
                  deletedAtMs: null,
                  createdAtMs: 0,
                  updatedAtMs: 0,
                },
              ],
            };
          }
          if (input.parentId === "folder-id") {
            return {
              items: [
                {
                  nodeId: "child-id",
                  mountId: mount.mountId,
                  parentId: "folder-id",
                  sourceRef: "dir/file.txt",
                  name: "file.txt",
                  kind: "file",
                  size: 4,
                  mtimeMs: 1,
                  providerVersion: null,
                  deletedAtMs: null,
                  createdAtMs: 0,
                  updatedAtMs: 0,
                },
              ],
            };
          }
          return { items: [] };
        },
      };

      const syncer = createVfsSyncer({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        nowMs: () => 4000,
      });
      await syncer.fullSync();

      const all = repo.listNodesByMountId(mount.mountId);
      const child = all.find((n) => n.sourceRef === "dir/file.txt");
      expect(child).toBeDefined();
      expect(child?.deletedAtMs).toBeNull();
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fullSync does not mark mount root node as deleted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-mount-root-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const mount = makeMount({ mountId: "local-testdata" });
      repo.upsertNodes([
        {
          nodeId: createVfsNodeId({ mountId: mount.mountId, sourceRef: "" }),
          mountId: mount.mountId,
          parentId: null,
          name: mount.mountId,
          kind: "mount",
          size: null,
          mtimeMs: null,
          sourceRef: "",
          providerVersion: null,
          deletedAtMs: null,
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ]);
      const provider: VfsProviderAdapter = {
        type: "mock",
        capabilities: { watch: false },
        async listChildren() {
          return { items: [] };
        },
      };

      const syncer = createVfsSyncer({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        nowMs: () => 5000,
      });
      await syncer.fullSync();

      const node = repo.listNodesByMountId(mount.mountId).find((n) => n.sourceRef === "");
      expect(node?.kind).toBe("mount");
      expect(node?.deletedAtMs).toBeNull();
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
