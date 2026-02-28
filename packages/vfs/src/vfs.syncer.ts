import { existsSync, createWriteStream, rmSync, statSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import pino, { type Logger } from "pino";
import { createVfsNodeId, createVfsParentId } from "./vfs.node-id";
import type { VfsProviderAdapter } from "./vfs.provider.types";
import type { VfsRepository } from "./vfs.repository.types";
import type { ListChildrenItem } from "./vfs.service.types";
import type { VfsMount, VfsNode } from "./vfs.types";

export type VfsSyncerEvent =
  | {
      type: "status";
      payload: {
        isSyncing: boolean;
        phase: "idle" | "metadata" | "content";
      };
    }
  | {
      type: "metadata_progress";
      payload: {
        total: number;
        processed: number;
        added: number;
        updated: number;
        deleted: number;
      };
    }
  | {
      type: "download_progress";
      payload: {
        sourceRef: string;
        totalSize: number;
        downloadedBytes: number;
        downloadPath: string;
      };
    };

export type VfsSyncer = {
  fullSync: () => Promise<void>;
  startWatching: () => Promise<void>;
  stopWatching: () => Promise<void>;
  subscribe: (listener: (event: VfsSyncerEvent) => void) => () => void;
};

export function createVfsSyncer(input: {
  mount: VfsMount;
  provider: VfsProviderAdapter;
  repository: VfsRepository;
  contentRootParent: string;
  nowMs?: () => number;
  logger?: Logger;
}): VfsSyncer {
  const nowMs = input.nowMs ?? (() => Date.now());
  const logger =
    input.logger ??
    pino({
      name: "knowdisk.vfs.syncer",
    });
  const listeners = new Set<(event: VfsSyncerEvent) => void>();
  let watchClose: (() => Promise<void>) | null = null;
  let watchQueue: Promise<void> = Promise.resolve();
  const emit = (event: VfsSyncerEvent) => {
    if (event.type === "status") {
      logger.info(
        {
          mountId: input.mount.mountId,
          phase: event.payload.phase,
          isSyncing: event.payload.isSyncing,
        },
        "syncer status changed",
      );
    }
    for (const listener of listeners) {
      listener(event);
    }
  };

  const itemSourceRef = (item: ListChildrenItem): string => item.sourceRef;
  const itemProviderId = (item: ListChildrenItem): string => item.nodeId || item.sourceRef;
  const sourceRefParent = (sourceRef: string): string | null => {
    const parts = sourceRef.split("/").filter((part) => part.length > 0);
    if (parts.length <= 1) {
      return null;
    }
    return parts.slice(0, parts.length - 1).join("/");
  };

  async function walkAllFiles(): Promise<Map<string, ListChildrenItem>> {
    const discovered = new Map<string, ListChildrenItem>();
    const queue: Array<{ parentId: string | null; parentSourceRef: string | null }> = [
      { parentId: null, parentSourceRef: null },
    ];
    while (queue.length > 0) {
      const { parentId, parentSourceRef } = queue.shift()!;
      let cursor: string | undefined;
      do {
        const page = await input.provider.listChildren({
          parentId,
          parentSourceRef,
          limit: 200,
          cursor,
        } as unknown as Parameters<typeof input.provider.listChildren>[0]);
        for (const item of page.items) {
          discovered.set(itemSourceRef(item), item);
          if (item.kind === "folder") {
            queue.push({
              parentId: itemProviderId(item),
              parentSourceRef: itemSourceRef(item),
            });
          }
        }
        cursor = page.nextCursor;
      } while (cursor);
    }
    return discovered;
  }

  async function enrichMetadataIfNeeded(item: ListChildrenItem): Promise<ListChildrenItem> {
    if (item.kind !== "file") {
      return item;
    }
    if ((item.size ?? 0) > 0) {
      return item;
    }
    if (!input.provider.getMetadata) {
      return item;
    }
    const fetched = await input.provider.getMetadata({
      id: itemProviderId(item),
      sourceRef: itemSourceRef(item),
    } as unknown as Parameters<NonNullable<typeof input.provider.getMetadata>>[0]);
    if (!fetched) {
      return item;
    }
    return {
      ...item,
      size: fetched.size ?? item.size,
      mtimeMs: fetched.mtimeMs ?? item.mtimeMs,
      providerVersion: fetched.providerVersion ?? item.providerVersion,
    };
  }

  function toNode(item: ListChildrenItem, now: number): VfsNode {
    const nodeId = createVfsNodeId({
      mountId: input.mount.mountId,
      sourceRef: itemSourceRef(item),
    });
    const parentId = createVfsParentId({
      mountId: input.mount.mountId,
      parentSourceRef: sourceRefParent(itemSourceRef(item)),
    });
    return {
      nodeId,
      mountId: input.mount.mountId,
      parentId,
      name: item.name,
      kind: item.kind,
      size: item.size ?? null,
      mtimeMs: item.mtimeMs ?? null,
      sourceRef: itemSourceRef(item),
      providerVersion: item.providerVersion ?? null,
      deletedAtMs: null,
      createdAtMs: now,
      updatedAtMs: now,
    };
  }

  async function syncContent(
    items: ListChildrenItem[],
    options?: { restartSourceRefs?: Set<string> },
  ): Promise<void> {
    if (!input.mount.syncContent || !input.provider.createReadStream) {
      return;
    }
    emit({ type: "status", payload: { isSyncing: true, phase: "content" } });
    for (const item of items) {
      if (item.kind !== "file") {
        continue;
      }
      const sourceRef = itemSourceRef(item);
      const finalPath = join(input.contentRootParent, input.mount.mountId, ...sourceRef.split("/"));
      const partPath = `${finalPath}.part`;
      await mkdir(dirname(finalPath), { recursive: true });
      const forceRestart = options?.restartSourceRefs?.has(sourceRef) ?? false;

      if (forceRestart) {
        rmSync(partPath, { force: true });
        rmSync(finalPath, { force: true });
      }

      if (!forceRestart && existsSync(finalPath) && (item.size ?? 0) > 0) {
        const current = statSync(finalPath).size;
        if (current === item.size) {
          emit({
            type: "download_progress",
            payload: {
              sourceRef,
              totalSize: item.size ?? 0,
              downloadedBytes: current,
              downloadPath: finalPath,
            },
          });
          continue;
        }
        rmSync(finalPath, { force: true });
      }

      let startOffset = 0;
      if (!forceRestart && existsSync(partPath)) {
        const partSize = statSync(partPath).size;
        if ((item.size ?? 0) > 0 && partSize > (item.size ?? 0)) {
          rmSync(partPath, { force: true });
          startOffset = 0;
        } else {
          startOffset = partSize;
        }
      }

      await downloadWithResume({
        provider: input.provider,
        item,
        finalPath,
        partPath,
        startOffset,
        onProgress(downloadedBytes) {
          emit({
            type: "download_progress",
            payload: {
              sourceRef,
              totalSize: item.size ?? 0,
              downloadedBytes,
              downloadPath: finalPath,
            },
          });
        },
      });
    }
  }

  return {
    async fullSync() {
      emit({ type: "status", payload: { isSyncing: true, phase: "metadata" } });
      const now = nowMs();
      const existing = input.repository.listNodesByMountId(input.mount.mountId);
      const existingByRef = new Map(existing.map((node) => [node.sourceRef, node]));

      const walked = await walkAllFiles();
      const walkedItems = [...walked.values()];
      logger.info(
        { mountId: input.mount.mountId, discoveredCount: walkedItems.length },
        "syncer discovered remote metadata",
      );

      let processed = 0;
      let added = 0;
      let updated = 0;
      const restartSourceRefs = new Set<string>();
      const upsertRows: VfsNode[] = [];
      for (const item of walkedItems) {
        const full = await enrichMetadataIfNeeded(item);
        const node = toNode(full, now);
        const prev = existingByRef.get(node.sourceRef);
        if (!prev) {
          added += 1;
        } else if (
          prev.deletedAtMs !== null ||
          prev.size !== node.size ||
          prev.mtimeMs !== node.mtimeMs ||
          prev.providerVersion !== node.providerVersion
        ) {
          updated += 1;
          node.createdAtMs = prev.createdAtMs;
          if (prev.providerVersion !== node.providerVersion) {
            restartSourceRefs.add(node.sourceRef);
          }
        } else {
          node.createdAtMs = prev.createdAtMs;
        }
        upsertRows.push(node);
        processed += 1;
        emit({
          type: "metadata_progress",
          payload: {
            total: walkedItems.length,
            processed,
            added,
            updated,
            deleted: 0,
          },
        });
      }

      const seen = new Set(walkedItems.map((item) => itemSourceRef(item)));
      const deletedRows = existing
        .filter(
          (node) =>
            node.kind !== "mount" &&
            node.deletedAtMs === null &&
            !seen.has(node.sourceRef),
        )
        .map((node) => ({
          ...node,
          deletedAtMs: now,
          updatedAtMs: now,
        }));

      if (upsertRows.length > 0) {
        input.repository.upsertNodes(upsertRows);
      }
      if (deletedRows.length > 0) {
        input.repository.upsertNodes(deletedRows);
      }
      emit({
        type: "metadata_progress",
        payload: {
          total: walkedItems.length,
          processed: walkedItems.length,
          added,
          updated,
          deleted: deletedRows.length,
        },
      });
      logger.info(
        {
          mountId: input.mount.mountId,
          total: walkedItems.length,
          added,
          updated,
          deleted: deletedRows.length,
        },
        "syncer metadata reconcile completed",
      );

      await syncContent(walkedItems, { restartSourceRefs });
      emit({ type: "status", payload: { isSyncing: false, phase: "idle" } });
    },

    async startWatching() {
      if (!input.provider.watch || watchClose) {
        return;
      }
      logger.info({ mountId: input.mount.mountId }, "syncer watch started");
      const active = await input.provider.watch({
        onEvent: (event) => {
          const normalizedEvent = {
            type: event.type,
            id: (event as { id?: string; sourceRef?: string }).id ?? (event as { sourceRef?: string }).sourceRef ?? "",
            parentId:
              (event as { parentId?: string | null; parentSourceRef?: string | null }).parentId ??
              (event as { parentSourceRef?: string | null }).parentSourceRef ??
              null,
          } as const;
          watchQueue = watchQueue
            .then(async () => {
              emit({ type: "status", payload: { isSyncing: true, phase: "metadata" } });
              await handleWatchEvent(normalizedEvent);
              emit({ type: "status", payload: { isSyncing: false, phase: "idle" } });
            })
            .catch(() => {
              emit({ type: "status", payload: { isSyncing: false, phase: "idle" } });
            });
        },
      });
      watchClose = active.close;
    },

    async stopWatching() {
      if (!watchClose) {
        return;
      }
      await watchQueue;
      await watchClose();
      watchClose = null;
      logger.info({ mountId: input.mount.mountId }, "syncer watch stopped");
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  async function handleWatchEvent(event: {
    type: "add" | "update_metadata" | "update_content" | "delete";
    id: string;
    parentId: string | null;
  }): Promise<void> {
    logger.info(
      {
        mountId: input.mount.mountId,
        type: event.type,
        id: event.id,
      },
      "syncer watch event received",
    );
    const now = nowMs();
    const all = input.repository.listNodesByMountId(input.mount.mountId);
    const prev = all.find((node) => node.sourceRef === event.id) ?? null;

    if (event.type === "delete") {
      if (!prev || prev.deletedAtMs !== null) {
        return;
      }
      input.repository.upsertNodes([
        {
          ...prev,
          deletedAtMs: now,
          updatedAtMs: now,
        },
      ]);
      emit({
        type: "metadata_progress",
        payload: { total: 1, processed: 1, added: 0, updated: 0, deleted: 1 },
      });
      return;
    }

    if (!input.provider.getMetadata) {
      return;
    }
    const fetched = await input.provider.getMetadata({
      id: event.id,
      sourceRef: event.id,
    } as unknown as Parameters<NonNullable<typeof input.provider.getMetadata>>[0]);
    if (!fetched) {
      if (!prev || prev.deletedAtMs !== null) {
        return;
      }
      input.repository.upsertNodes([
        {
          ...prev,
          deletedAtMs: now,
          updatedAtMs: now,
        },
      ]);
      emit({
        type: "metadata_progress",
        payload: { total: 1, processed: 1, added: 0, updated: 0, deleted: 1 },
      });
      return;
    }

    const node = toNode(fetched, now);
    if (prev) {
      node.createdAtMs = prev.createdAtMs;
    }
    input.repository.upsertNodes([node]);
    emit({
      type: "metadata_progress",
      payload: {
        total: 1,
        processed: 1,
        added: prev ? 0 : 1,
        updated: prev ? 1 : 0,
        deleted: 0,
      },
    });

    const shouldSyncSingle =
      input.mount.syncContent &&
      input.provider.createReadStream &&
      fetched.kind === "file" &&
      (event.type === "update_content" ||
        !prev ||
        prev.deletedAtMs !== null ||
        prev.size !== node.size ||
        prev.mtimeMs !== node.mtimeMs ||
        prev.providerVersion !== node.providerVersion ||
        !existsSync(join(input.contentRootParent, input.mount.mountId, ...fetched.sourceRef.split("/"))));
    if (!shouldSyncSingle) {
      return;
    }

    const restartSourceRefs = new Set<string>();
    if (prev && prev.providerVersion !== node.providerVersion) {
      restartSourceRefs.add(fetched.sourceRef);
    }
    await syncContent([fetched], { restartSourceRefs });
  }
}

async function downloadWithResume(input: {
  provider: VfsProviderAdapter;
  item: ListChildrenItem;
  finalPath: string;
  partPath: string;
  startOffset: number;
  onProgress: (downloadedBytes: number) => void;
}): Promise<void> {
  let startOffset = input.startOffset;
  let retried = false;
  while (true) {
    try {
      const stream = await input.provider.createReadStream!({
        id: input.item.nodeId || input.item.sourceRef,
        sourceRef: input.item.sourceRef,
        offset: startOffset > 0 ? startOffset : undefined,
      } as unknown as Parameters<NonNullable<typeof input.provider.createReadStream>>[0]);
      const writer = createWriteStream(input.partPath, {
        flags: startOffset > 0 ? "a" : "w",
      });
      const reader = stream.getReader();
      let loaded = startOffset;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (!value || value.length === 0) {
            continue;
          }
          loaded += value.length;
          await new Promise<void>((resolve, reject) => {
            writer.write(Buffer.from(value), (error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          });
          input.onProgress(loaded);
        }
      } finally {
        await new Promise<void>((resolve, reject) => {
          writer.end((error: Error | null | undefined) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }

      if ((input.item.size ?? 0) > 0 && loaded < (input.item.size ?? 0)) {
        throw new Error(
          `Downloaded file is incomplete: ${input.item.sourceRef} (${loaded}/${input.item.size})`,
        );
      }
      await rename(input.partPath, input.finalPath);
      input.onProgress(loaded);
      return;
    } catch (error) {
      if (startOffset > 0 && !retried) {
        rmSync(input.partPath, { force: true });
        startOffset = 0;
        retried = true;
        continue;
      }
      throw error;
    }
  }
}
