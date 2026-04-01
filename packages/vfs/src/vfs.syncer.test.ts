import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalVfsProvider } from "./provider/local";
import {
  createVfsContentNodeEventsProcessor,
  createVfsMetadataNodeEventsProcessor,
} from "./vfs.node-event-processor";
import { createVfsNodeId, decodeBase64UrlNodeIdToUuid } from "./vfs.node-id";
import { createVfsRepository } from "./vfs.repository";
import {
  createVfsSyncer,
  type VfsSyncerEvent,
  type VfsSyncerHookRunner,
} from "./vfs.syncer";
import type { VfsProviderAdapter } from "./vfs.provider.types";
import type { VfsMount } from "./vfs.types";

function createMockLogger() {
  const records: Array<{
    level: "info" | "warn" | "error" | "debug";
    obj: unknown;
    msg: string;
  }> = [];
  return {
    logger: {
      info: (obj: unknown, msg?: string) => records.push({ level: "info", obj, msg: msg ?? "" }),
      warn: (obj: unknown, msg?: string) => records.push({ level: "warn", obj, msg: msg ?? "" }),
      error: (obj: unknown, msg?: string) => records.push({ level: "error", obj, msg: msg ?? "" }),
      debug: (obj: unknown, msg?: string) => records.push({ level: "debug", obj, msg: msg ?? "" }),
    },
    records,
  };
}

function makeMount(extra?: Partial<VfsMount>): VfsMount {
  return {
    mountId: "m1",
    providerType: "mock",
    providerExtra: {},
    metadataTtlSec: 60,
    reconcileIntervalMs: 1000,
    ...extra,
  };
}

function createTestNodeEventsProcessor(input: {
  mount: VfsMount;
  provider: VfsProviderAdapter;
  repository: ReturnType<typeof createVfsRepository>;
  contentRootParent: string;
  hooks?: VfsSyncerHookRunner;
  nowMs?: () => number;
  logger?: unknown;
  events?: VfsSyncerEvent[];
}) {
  const metadataProcessor = createVfsMetadataNodeEventsProcessor({
    repository: input.repository,
    contentRootParent: input.contentRootParent,
    resolveMount(mountId) {
      return mountId === input.mount.mountId ? input.mount : null;
    },
    resolveProvider() {
      return input.provider;
    },
    hooks: input.hooks,
    nowMs: input.nowMs,
    logger: input.logger as never,
    emitSyncerEvent(mountId, event) {
      if (mountId === input.mount.mountId) {
        input.events?.push(event);
      }
    },
  });
  const contentProcessor = createVfsContentNodeEventsProcessor({
    repository: input.repository,
    contentRootParent: input.contentRootParent,
    resolveMount(mountId) {
      return mountId === input.mount.mountId ? input.mount : null;
    },
    resolveProvider() {
      return input.provider;
    },
    hooks: input.hooks,
    nowMs: input.nowMs,
    logger: input.logger as never,
    emitSyncerEvent(mountId, event) {
      if (mountId === input.mount.mountId) {
        input.events?.push(event);
      }
    },
  });
  return {
    ...metadataProcessor,
    rememberMount() {},
    start() {
      metadataProcessor.start();
      contentProcessor.start();
    },
    close() {
      metadataProcessor.close();
      contentProcessor.close();
    },
    async drainMount(options?: { allowContentSync?: boolean; includeContentUpdates?: boolean }) {
      const metadata = await metadataProcessor.drain();
      if (options?.includeContentUpdates === false) {
        return metadata;
      }
      const content = await contentProcessor.drain({
        allowContentSync: options?.allowContentSync,
      });
      return content.blocked ? content : metadata;
    },
  };
}

function listQueuedEvents(repo: ReturnType<typeof createVfsRepository>, mountId: string) {
  return repo.listNodeEvents().filter((event) => event.mountId === mountId);
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
    const insertedEvents: Array<{
      sourceRef: string;
      mountId: string;
      parentId: string | null;
      type: "add" | "update_metadata" | "update_content" | "delete";
      node: import("./vfs.types").VfsNode | null;
      createdAtMs: number;
    }> = [];
    try {
      const mount = makeMount();
      repo.upsertNodes([
        {
          nodeId: createVfsNodeId({
            mountId: mount.mountId,
            sourceRef: "",
          }),
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
          if (input.id === "a.txt") {
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
        repository: {
          ...repo,
          insertNodeEvents(rows) {
            insertedEvents.push(...rows);
            repo.insertNodeEvents(rows);
          },
        },
        contentRootParent: join(dir, "content"),
        nowMs: () => 1000,
      });
      const processor = createTestNodeEventsProcessor({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        nowMs: () => 1000,
      });
      const events: Array<{ type: string; payload: unknown }> = [];
      const off = syncer.subscribe((event) => events.push(event));
      await syncer.fullSync();
      await processor.drainMount({
        allowContentSync: false,
        includeContentUpdates: false,
      });
      off();

      const all = repo.listNodesByMountId(mount.mountId);
      const a = all.find((n) => n.sourceRef === "a.txt");
      const b = all.find((n) => n.sourceRef === "b.txt");
      const legacy = all.find((n) => n.sourceRef === "legacy.txt");
      const mountNode = all.find((n) => n.kind === "mount" && n.sourceRef === "");
      expect(a?.size).toBe(5);
      expect(b?.size).toBe(2);
      expect(() => decodeBase64UrlNodeIdToUuid(a!.nodeId)).not.toThrow();
      expect(a?.parentId).toBe(mountNode?.nodeId ?? null);
      expect(legacy?.deletedAtMs).toBe(1000);
      expect(insertedEvents.map((event) => [event.sourceRef, event.type])).toEqual([
        ["a.txt", "add"],
        ["a.txt", "update_metadata"],
        ["a.txt", "update_content"],
        ["b.txt", "add"],
        ["b.txt", "update_metadata"],
        ["b.txt", "update_content"],
        ["legacy.txt", "delete"],
      ]);
      expect(insertedEvents.find((event) => event.sourceRef === "a.txt")?.node?.size).toBe(5);
      expect(events.some((e) => e.type === "status")).toBe(true);
      expect(events.some((e) => e.type === "metadata_progress")).toBe(true);
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fullSync only enqueues update_content event and does not download content immediately", async () => {
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
        async getMetadata() {
          return {
            sourceRef: "f.txt",
            parentSourceRef: null,
            name: "f.txt",
            kind: "file",
            size: 6,
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

      expect(offsets).toEqual([]);
      expect(() => readFileSync(join(contentParent, mount.mountId, "f.txt"), "utf8")).toThrow();
      const queued = listQueuedEvents(repo, mount.mountId);
      expect(
        queued.some((event) => event.sourceRef === "f.txt" && event.type === "update_content")
      ).toBe(true);
      expect(events.some((e) => e.type === "download_progress")).toBe(false);
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("node events processor consumes queued metadata events without watch loop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-fullsync-events-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const mount = makeMount();
      repo.upsertNodes([
        {
          nodeId: createVfsNodeId({
            mountId: mount.mountId,
            sourceRef: "",
          }),
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
          return {
            items: [
              {
                sourceRef: "f.txt",
                parentSourceRef: null,
                name: "f.txt",
                kind: "file",
                size: 3,
              },
            ],
          };
        },
        async getMetadata() {
          return {
            sourceRef: "f.txt",
            parentSourceRef: null,
            name: "f.txt",
            kind: "file",
            size: 3,
          };
        },
      };

      const syncer = createVfsSyncer({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        nowMs: () => 3000,
      });
      const processorEvents: VfsSyncerEvent[] = [];
      const processor = createTestNodeEventsProcessor({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        nowMs: () => 3000,
        events: processorEvents,
      });

      const events: Array<{ type: string; payload: unknown }> = [];
      const off = syncer.subscribe((event) => events.push(event));
      await syncer.fullSync();
      await processor.drainMount({
        allowContentSync: false,
        includeContentUpdates: false,
      });
      off();

      expect(listQueuedEvents(repo, mount.mountId)).toEqual([
        expect.objectContaining({
          sourceRef: "f.txt",
          mountId: mount.mountId,
          type: "update_content",
        }),
      ]);
      expect(repo.listNodesByMountIdAndSourceRef(mount.mountId, "f.txt")?.size).toBe(3);
      expect(
        processorEvents.some(
          (event) =>
            event.type === "queue_progress" &&
            (event.payload as { pendingUnits: number }).pendingUnits === 1
        )
      ).toBe(true);
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("node events processor refreshes queue progress when queued event is deleted externally", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-external-delete-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const mount = makeMount({ syncContent: true });
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
      repo.insertNodeEvents([
        {
          sourceRef: "f.txt",
          mountId: mount.mountId,
          parentId: createVfsNodeId({ mountId: mount.mountId, sourceRef: "" }),
          type: "update_content",
          node: null,
          createdAtMs: 2,
        },
      ]);
      const provider: VfsProviderAdapter = {
        type: "mock",
        capabilities: { watch: true },
        async listChildren() {
          return { items: [] };
        },
        async getMetadata() {
          return null;
        },
        async createReadStream() {
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("abcdef"));
              controller.close();
            },
          });
        },
        async watch() {
          return {
            close: async () => {},
          };
        },
      };
      const events: VfsSyncerEvent[] = [];
      const processor = createTestNodeEventsProcessor({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        nowMs: () => 3000,
        hooks: {
          async beforeNodeEvent() {
            throw new Error("blocked");
          },
        },
        events,
      });

      processor.start();
      const queued = listQueuedEvents(repo, mount.mountId);
      repo.deleteNodeEvents([{ id: queued[0]!.id, mountId: mount.mountId }]);

      const refreshed = await waitUntil(
        () =>
          events.some(
            (event) =>
              event.type === "queue_progress" &&
              (event.payload as { pendingUnits: number }).pendingUnits === 0
          ),
        500
      );
      processor.close();

      expect(refreshed).toBe(true);
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("beforeAdd hook failure keeps event queued", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-before-add-hook-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const mount = makeMount();
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
          return {
            items: [
              {
                sourceRef: "f.txt",
                parentSourceRef: null,
                name: "f.txt",
                kind: "file",
                size: 3,
              },
            ],
          };
        },
        async getMetadata() {
          return {
            sourceRef: "f.txt",
            parentSourceRef: null,
            name: "f.txt",
            kind: "file",
            size: 3,
          };
        },
      };

      const syncer = createVfsSyncer({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        nowMs: () => 3000,
      });
      const processor = createTestNodeEventsProcessor({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        hooks: {
          async beforeNodeEvent(hookName) {
            if (hookName === "beforeAdd") {
              throw new Error("blocked");
            }
          },
        },
        nowMs: () => 3000,
      });

      await syncer.fullSync();
      await processor.drainMount({
        allowContentSync: false,
        includeContentUpdates: false,
      });

      expect(repo.listNodesByMountIdAndSourceRef(mount.mountId, "f.txt")).toBeNull();
      expect(listQueuedEvents(repo, mount.mountId).map((event) => event.type)).toEqual([
        "add",
        "update_content",
        "update_metadata",
      ]);
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("afterAdd hook failure still deletes the add event", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-after-add-hook-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const mount = makeMount();
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
          return {
            items: [
              {
                sourceRef: "f.txt",
                parentSourceRef: null,
                name: "f.txt",
                kind: "file",
                size: 3,
              },
            ],
          };
        },
        async getMetadata() {
          return {
            sourceRef: "f.txt",
            parentSourceRef: null,
            name: "f.txt",
            kind: "file",
            size: 3,
          };
        },
      };

      const syncer = createVfsSyncer({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        nowMs: () => 3000,
      });
      const processor = createTestNodeEventsProcessor({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        hooks: {
          async afterNodeEvent(hookName) {
            if (hookName === "afterAdd") {
              throw new Error("post-fail");
            }
          },
        },
        nowMs: () => 3000,
      });

      await syncer.fullSync();
      await processor.drainMount({
        allowContentSync: false,
        includeContentUpdates: false,
      });

      expect(repo.listNodesByMountIdAndSourceRef(mount.mountId, "f.txt")?.size).toBe(3);
      expect(listQueuedEvents(repo, mount.mountId)).toEqual([
        expect.objectContaining({ sourceRef: "f.txt", type: "update_content" }),
      ]);
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("beforeUpdateContent hook failure keeps update_content queued", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-before-update-content-hook-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const mount = makeMount({ syncContent: true });
      const contentParent = join(dir, "content");
      const provider: VfsProviderAdapter = {
        type: "mock",
        capabilities: { watch: true },
        async listChildren() {
          return { items: [] };
        },
        async getMetadata(input) {
          return {
            sourceRef: input.id,
            parentSourceRef: null,
            name: input.id,
            kind: "file",
            size: 6,
          };
        },
        async createReadStream() {
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("abcdef"));
              controller.close();
            },
          });
        },
        async watch() {
          return {
            close: async () => {},
          };
        },
      };
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
      repo.insertNodeEvents([
        {
          sourceRef: "f.txt",
          mountId: mount.mountId,
          parentId: createVfsNodeId({ mountId: mount.mountId, sourceRef: "" }),
          type: "update_content",
          node: null,
          createdAtMs: 2,
        },
      ]);

      const processor = createTestNodeEventsProcessor({
        mount,
        provider,
        repository: repo,
        contentRootParent: contentParent,
        hooks: {
          async beforeNodeEvent(hookName) {
            if (hookName !== "beforeUpdateContent") {
              return;
            }
            throw new Error("stop-content");
          },
        },
        nowMs: () => 3000,
      });

      processor.start();
      const drained = await waitUntil(
        () => listQueuedEvents(repo, mount.mountId).length === 1,
        500
      );
      processor.close();

      expect(drained).toBe(true);
      expect(() => readFileSync(join(contentParent, mount.mountId, "f.txt"), "utf8")).toThrow();
      expect(listQueuedEvents(repo, mount.mountId)).toEqual([
        expect.objectContaining({ sourceRef: "f.txt", type: "update_content" }),
      ]);
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("afterUpdateContent hook failure still finalizes file and deletes event", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-after-update-content-hook-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const mount = makeMount({ syncContent: true });
      const contentParent = join(dir, "content");
      const provider: VfsProviderAdapter = {
        type: "mock",
        capabilities: { watch: true },
        async listChildren() {
          return { items: [] };
        },
        async getMetadata(input) {
          return {
            sourceRef: input.id,
            parentSourceRef: null,
            name: input.id,
            kind: "file",
            size: 6,
          };
        },
        async createReadStream() {
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("abcdef"));
              controller.close();
            },
          });
        },
        async watch() {
          return {
            close: async () => {},
          };
        },
      };
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
      repo.insertNodeEvents([
        {
          sourceRef: "f.txt",
          mountId: mount.mountId,
          parentId: createVfsNodeId({ mountId: mount.mountId, sourceRef: "" }),
          type: "update_content",
          node: null,
          createdAtMs: 2,
        },
      ]);

      const processor = createTestNodeEventsProcessor({
        mount,
        provider,
        repository: repo,
        contentRootParent: contentParent,
        hooks: {
          async afterNodeEvent(hookName) {
            if (hookName !== "afterUpdateContent") {
              return;
            }
            throw new Error("after-update-content");
          },
        },
        nowMs: () => 3000,
      });

      processor.start();
      const drained = await waitUntil(
        () => listQueuedEvents(repo, mount.mountId).length === 0,
        500
      );
      processor.close();

      expect(drained).toBe(true);
      expect(readFileSync(join(contentParent, mount.mountId, "f.txt"), "utf8")).toBe("abcdef");
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("logs structured fields for blocked before hook failures", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-before-hook-log-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const mount = makeMount();
      const mock = createMockLogger();
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
          return {
            items: [
              {
                sourceRef: "f.txt",
                parentSourceRef: null,
                name: "f.txt",
                kind: "file",
                size: 3,
              },
            ],
          };
        },
        async getMetadata() {
          return {
            sourceRef: "f.txt",
            parentSourceRef: null,
            name: "f.txt",
            kind: "file",
            size: 3,
          };
        },
      };

      const syncer = createVfsSyncer({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        logger: mock.logger as never,
        nowMs: () => 3000,
      });
      const processor = createTestNodeEventsProcessor({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        hooks: {
          async beforeNodeEvent(hookName) {
            if (hookName === "beforeAdd") {
              throw new Error("blocked");
            }
          },
        },
        logger: mock.logger,
        nowMs: () => 3000,
      });

      await syncer.fullSync();
      await processor.drainMount({
        allowContentSync: false,
        includeContentUpdates: false,
      });

      expect(mock.records).toContainEqual(
        expect.objectContaining({
          level: "warn",
          msg: "syncer nodeEvents handler blocked by hook",
          obj: expect.objectContaining({
            mountId: mount.mountId,
            sourceRef: "f.txt",
            eventType: "add",
            hookName: "beforeAdd",
            stage: "before",
            error: "Error: blocked",
          }),
        })
      );
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("logs structured fields for afterUpdateContent hook failures", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-after-update-content-log-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const mount = makeMount({ syncContent: true });
      const contentParent = join(dir, "content");
      const mock = createMockLogger();
      const provider: VfsProviderAdapter = {
        type: "mock",
        capabilities: { watch: true },
        async listChildren() {
          return { items: [] };
        },
        async getMetadata(input) {
          return {
            sourceRef: input.id,
            parentSourceRef: null,
            name: input.id,
            kind: "file",
            size: 6,
          };
        },
        async createReadStream() {
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("abcdef"));
              controller.close();
            },
          });
        },
        async watch() {
          return {
            close: async () => {},
          };
        },
      };
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
      repo.insertNodeEvents([
        {
          sourceRef: "f.txt",
          mountId: mount.mountId,
          parentId: createVfsNodeId({ mountId: mount.mountId, sourceRef: "" }),
          type: "update_content",
          node: null,
          createdAtMs: 2,
        },
      ]);

      const processor = createTestNodeEventsProcessor({
        mount,
        provider,
        repository: repo,
        contentRootParent: contentParent,
        hooks: {
          async afterNodeEvent(hookName) {
            if (hookName !== "afterUpdateContent") {
              return;
            }
            throw new Error("after-update-content");
          },
        },
        logger: mock.logger,
        nowMs: () => 3000,
      });

      processor.start();
      const drained = await waitUntil(
        () => listQueuedEvents(repo, mount.mountId).length === 0,
        500
      );
      processor.close();

      expect(drained).toBe(true);
      expect(mock.records).toContainEqual(
        expect.objectContaining({
          level: "warn",
          msg: "syncer event hook failed",
          obj: expect.objectContaining({
            mountId: mount.mountId,
            sourceRef: "f.txt",
            eventType: "update_content",
            hookName: "afterUpdateContent",
            stage: "after",
            error: "Error: after-update-content",
          }),
        })
      );
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fullSync enriches mtime when requiredFields includes mtimeMs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-required-fields-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const mount = makeMount();
      repo.upsertNodes([
        {
          nodeId: createVfsNodeId({
            mountId: mount.mountId,
            sourceRef: "",
          }),
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
          return {
            items: [
              {
                sourceRef: "a.txt",
                parentSourceRef: null,
                name: "a.txt",
                kind: "file",
                size: 2,
                mtimeMs: null,
                providerVersion: null,
              },
            ],
          };
        },
        async getMetadata() {
          return {
            sourceRef: "a.txt",
            parentSourceRef: null,
            name: "a.txt",
            kind: "file",
            size: 2,
            mtimeMs: 123,
            providerVersion: null,
          };
        },
      };
      const syncer = createVfsSyncer({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        requiredFields: ["size", "mtimeMs"],
        nowMs: () => 1000,
      });
      const processor = createTestNodeEventsProcessor({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        nowMs: () => 1000,
      });

      await syncer.fullSync();
      await processor.drainMount({
        allowContentSync: false,
        includeContentUpdates: false,
      });
      const node = repo.listNodesByMountIdAndSourceRef(mount.mountId, "a.txt");
      expect(node?.mtimeMs).toBe(123);
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
            type: "add" | "update" | "delete";
            id: string;
            parentId: string | null;
            contentUpdated: boolean | null;
            metadataChanged: boolean | null;
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
          if (input.id === "f.txt") {
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
      const processor = createTestNodeEventsProcessor({
        mount,
        provider,
        repository: repo,
        contentRootParent: contentParent,
        nowMs: () => 3000,
      });
      processor.start();
      await syncer.startWatching();
      watchHandler?.({
        type: "update",
        id: "f.txt",
        parentId: null,
        contentUpdated: true,
        metadataChanged: false,
      });
      const updated = await waitUntil(() => {
        const node = repo.listNodesByMountIdAndSourceRef(mount.mountId, "f.txt");
        return node?.providerVersion === "v2";
      }, 2000);

      expect(updated).toBe(true);
      expect(metadataCalls).toBeGreaterThan(0);
      expect(offsets).toEqual([0]);
      expect(readFileSync(join(contentParent, mount.mountId, "f.txt"), "utf8")).toBe("new");

      watchHandler?.({
        type: "delete",
        id: "f.txt",
        parentId: null,
        contentUpdated: null,
        metadataChanged: null,
      });
      const deleted = await waitUntil(() => {
        const node = repo.listNodesByMountIdAndSourceRef(mount.mountId, "f.txt");
        return (node?.deletedAtMs ?? null) !== null;
      }, 2000);
      expect(deleted).toBe(true);
      await syncer.stopWatching();
      processor.close();
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
        async getMetadata() {
          return null;
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
          (record) => record.level === "info" && record.msg.includes("syncer status changed")
        )
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
        async getMetadata(input) {
          if (input.id === "dir/file.txt") {
            return {
              sourceRef: "dir/file.txt",
              parentSourceRef: "dir",
              name: "file.txt",
              kind: "file",
              size: 4,
              mtimeMs: 1,
              providerVersion: null,
            };
          }
          if (input.id === "dir") {
            return {
              sourceRef: "dir",
              parentSourceRef: null,
              name: "dir",
              kind: "folder",
              size: null,
              mtimeMs: null,
              providerVersion: null,
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
        nowMs: () => 4000,
      });
      const processor = createTestNodeEventsProcessor({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        nowMs: () => 4000,
      });
      await syncer.fullSync();
      await processor.drainMount({
        allowContentSync: false,
        includeContentUpdates: false,
      });

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
        async getMetadata() {
          return null;
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

      const node = repo.listNodesByMountIdAndSourceRef(mount.mountId, "");
      expect(node?.kind).toBe("mount");
      expect(node?.deletedAtMs).toBeNull();
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("syncName=false: fullSync preserves existing db name for local nodes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-sync-name-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const sourceRoot = join(dir, "source");
      await mkdir(sourceRoot, { recursive: true });
      writeFileSync(join(sourceRoot, "a.txt"), "v2");
      const mount = makeMount({
        mountId: "local-sync-name",
        providerType: "local",
        providerExtra: { directory: sourceRoot, syncName: false },
      });
      repo.upsertNodes([
        {
          nodeId: createVfsNodeId({
            mountId: mount.mountId,
            sourceRef: "",
          }),
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
        {
          nodeId: createVfsNodeId({
            mountId: mount.mountId,
            sourceRef: "a.txt",
          }),
          mountId: mount.mountId,
          parentId: createVfsNodeId({
            mountId: mount.mountId,
            sourceRef: "",
          }),
          name: "manual-display-name.txt",
          kind: "file",
          size: 1,
          mtimeMs: 1,
          sourceRef: "a.txt",
          providerVersion: null,
          deletedAtMs: null,
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ]);

      const provider = createLocalVfsProvider(mount);

      const syncer = createVfsSyncer({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        nowMs: () => 2000,
      });
      const processor = createTestNodeEventsProcessor({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        nowMs: () => 2000,
      });
      await syncer.fullSync();
      await processor.drainMount({
        allowContentSync: false,
        includeContentUpdates: false,
      });
      const next = repo.listNodesByMountIdAndSourceRef(mount.mountId, "a.txt");
      expect(next?.name).toBe("manual-display-name.txt");
      expect(next?.size).toBe(2);
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("syncName=false: watch update preserves existing db name for local nodes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-sync-name-watch-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const mount = makeMount({
        mountId: "local-sync-name-watch",
        providerType: "local",
        providerExtra: { syncName: false },
      });
      const mountNodeId = createVfsNodeId({
        mountId: mount.mountId,
        sourceRef: "",
      });
      repo.upsertNodes([
        {
          nodeId: mountNodeId,
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
        {
          nodeId: createVfsNodeId({
            mountId: mount.mountId,
            sourceRef: "a.txt",
          }),
          mountId: mount.mountId,
          parentId: mountNodeId,
          name: "manual-display-name.txt",
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

      let watchHandler:
        | ((event: {
            type: "add" | "update" | "delete";
            id: string;
            parentId: string | null;
            contentUpdated: boolean | null;
            metadataChanged: boolean | null;
          }) => void)
        | null = null;
      const provider: VfsProviderAdapter = {
        type: "local",
        capabilities: { watch: true },
        async listChildren() {
          return { items: [] };
        },
        async getMetadata() {
          return {
            sourceRef: "a.txt",
            parentSourceRef: null,
            name: "a.txt",
            kind: "file",
            size: 2,
            providerVersion: "v2",
          };
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
        contentRootParent: join(dir, "content"),
        nowMs: () => 3000,
      });
      const processor = createTestNodeEventsProcessor({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        nowMs: () => 3000,
      });
      processor.start();
      await syncer.startWatching();
      watchHandler?.({
        type: "update",
        id: "a.txt",
        parentId: null,
        contentUpdated: true,
        metadataChanged: false,
      });
      const updated = await waitUntil(() => {
        const node = repo.listNodesByMountIdAndSourceRef(mount.mountId, "a.txt");
        return node?.providerVersion === "v2";
      }, 2000);
      expect(updated).toBe(true);
      const node = repo.listNodesByMountIdAndSourceRef(mount.mountId, "a.txt");
      expect(node?.name).toBe("manual-display-name.txt");
      await syncer.stopWatching();
      processor.close();
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("local fullSync computes providerVersion from file content and updates on re-index", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-local-hash-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const sourceRoot = join(dir, "source");
      await mkdir(sourceRoot, { recursive: true });
      const filePath = join(sourceRoot, "a.txt");
      writeFileSync(filePath, "v1");

      const mount = makeMount({
        mountId: "local-hash",
        providerType: "local",
        providerExtra: { directory: sourceRoot },
      });
      repo.upsertNodes([
        {
          nodeId: createVfsNodeId({
            mountId: mount.mountId,
            sourceRef: "",
          }),
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

      const provider = createLocalVfsProvider(mount);

      const syncer = createVfsSyncer({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        nowMs: () => 1000,
      });
      const processor = createTestNodeEventsProcessor({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        nowMs: () => 1000,
      });

      await syncer.fullSync();
      await processor.drainMount({
        allowContentSync: false,
        includeContentUpdates: false,
      });
      const before = repo.listNodesByMountIdAndSourceRef(mount.mountId, "a.txt");
      expect(before?.providerVersion).toEqual(expect.any(String));

      writeFileSync(filePath, "v2");
      await syncer.fullSync();
      await processor.drainMount({
        allowContentSync: false,
        includeContentUpdates: false,
      });
      const after = repo.listNodesByMountIdAndSourceRef(mount.mountId, "a.txt");
      expect(after?.providerVersion).toEqual(expect.any(String));
      expect(after?.providerVersion).not.toBe(before?.providerVersion ?? null);
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fullSync prefers provider getVersion over local hash fallback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-get-version-first-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const sourceRoot = join(dir, "source");
      await mkdir(sourceRoot, { recursive: true });
      writeFileSync(join(sourceRoot, "a.txt"), "v1");

      const mount = makeMount({
        mountId: "local-version",
        providerType: "local",
        providerExtra: { directory: sourceRoot },
      });
      repo.upsertNodes([
        {
          nodeId: createVfsNodeId({
            mountId: mount.mountId,
            sourceRef: "",
          }),
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

      let providerVersion = "pv1";
      const provider: VfsProviderAdapter = {
        type: "local",
        capabilities: { watch: false },
        async listChildren() {
          return {
            items: [
              {
                sourceRef: "a.txt",
                parentSourceRef: null,
                name: "a.txt",
                kind: "file",
                size: 2,
              },
            ],
          };
        },
        async getMetadata() {
          return {
            sourceRef: "a.txt",
            parentSourceRef: null,
            name: "a.txt",
            kind: "file",
            size: 2,
          };
        },
        async getVersion() {
          return providerVersion;
        },
      };

      const syncer = createVfsSyncer({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        nowMs: () => 1000,
      });
      const processor = createTestNodeEventsProcessor({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        nowMs: () => 1000,
      });

      await syncer.fullSync();
      await processor.drainMount({
        allowContentSync: false,
        includeContentUpdates: false,
      });
      let node = repo.listNodesByMountIdAndSourceRef(mount.mountId, "a.txt");
      expect(node?.providerVersion).toBe("pv1");

      providerVersion = "pv2";
      await syncer.fullSync();
      await processor.drainMount({
        allowContentSync: false,
        includeContentUpdates: false,
      });
      node = repo.listNodesByMountIdAndSourceRef(mount.mountId, "a.txt");
      expect(node?.providerVersion).toBe("pv2");
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
