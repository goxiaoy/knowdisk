import { createWriteStream, existsSync, rmSync, statSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import pino, { type Logger } from "pino";
import { enrichMetadataIfNeeded } from "./vfs.provider.walk";
import type { VfsProviderAdapter } from "./vfs.provider.types";
import type { VfsNodeEventRow, VfsRepository } from "./vfs.repository.types";
import type { VfsNodeEventHookContext } from "./vfs.service.types";
import type { VfsSyncerEvent, VfsSyncerHookRunner } from "./vfs.syncer";
import type { VfsMount, VfsNode } from "./vfs.types";
import { createVfsNodeId } from "./vfs.node-id";

class BlockingHookError extends Error {
  constructor(
    message: string,
    readonly causeValue: unknown
  ) {
    super(message);
  }
}

type VfsNodeEventHookName =
  | "beforeAdd"
  | "afterAdd"
  | "beforeUpdateMetadata"
  | "afterUpdateMetadata"
  | "beforeUpdateContent"
  | "afterUpdateContent"
  | "beforeDelete"
  | "afterDelete";

export type VfsNodeEventsProcessor = {
  start: () => void;
  close: () => void;
  drain: (options?: { allowContentSync?: boolean }) => Promise<{ blocked: boolean }>;
};

type VfsNodeEventProcessorType = VfsNodeEventRow["type"];

function toBeforeHookName(type: VfsNodeEventRow["type"]): VfsNodeEventHookName {
  switch (type) {
    case "add":
      return "beforeAdd";
    case "update_metadata":
      return "beforeUpdateMetadata";
    case "update_content":
      return "beforeUpdateContent";
    case "delete":
      return "beforeDelete";
  }
}

function toAfterHookName(type: VfsNodeEventRow["type"]): VfsNodeEventHookName {
  switch (type) {
    case "add":
      return "afterAdd";
    case "update_metadata":
      return "afterUpdateMetadata";
    case "update_content":
      return "afterUpdateContent";
    case "delete":
      return "afterDelete";
  }
}

function sourceRefParent(sourceRef: string): string | null {
  const parts = sourceRef.split("/").filter((part) => part.length > 0);
  if (parts.length <= 1) {
    return null;
  }
  return parts.slice(0, parts.length - 1).join("/");
}

function toNode(mount: VfsMount, item: VfsNode, now: number): VfsNode {
  const nodeId = createVfsNodeId({
    mountId: mount.mountId,
    sourceRef: item.sourceRef,
  });
  const parentSourceRef = sourceRefParent(item.sourceRef);
  const parentId = parentSourceRef
    ? createVfsNodeId({
        mountId: mount.mountId,
        sourceRef: parentSourceRef,
      })
    : createVfsNodeId({
        mountId: mount.mountId,
        sourceRef: "",
      });
  return {
    nodeId,
    mountId: mount.mountId,
    parentId,
    name: item.name,
    kind: item.kind,
    size: item.size ?? null,
    mtimeMs: item.mtimeMs ?? null,
    sourceRef: item.sourceRef,
    providerVersion: item.providerVersion ?? null,
    deletedAtMs: null,
    createdAtMs: now,
    updatedAtMs: now,
  };
}

async function downloadWithResume(input: {
  provider: VfsProviderAdapter;
  item: VfsNode;
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
        id: input.item.sourceRef,
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
      await rename(input.partPath, input.finalPath);
      return;
    } catch (error) {
      if (!retried && startOffset > 0) {
        retried = true;
        startOffset = 0;
        rmSync(input.partPath, { force: true });
        continue;
      }
      throw error;
    }
  }
}

async function syncContent(input: {
  mount: VfsMount;
  provider: VfsProviderAdapter;
  contentRootParent: string;
  emit?: (event: VfsSyncerEvent) => void;
  items: VfsNode[];
  restartSourceRefs?: Set<string>;
}): Promise<void> {
  if (!input.mount.syncContent || !input.provider.createReadStream) {
    return;
  }
  input.emit?.({ type: "status", payload: { isSyncing: true, phase: "content" } });
  for (const item of input.items) {
    if (item.kind !== "file") {
      continue;
    }
    const sourceRef = item.sourceRef;
    const finalPath = join(input.contentRootParent, input.mount.mountId, ...sourceRef.split("/"));
    const partPath = `${finalPath}.part`;
    await mkdir(dirname(finalPath), { recursive: true });
    const forceRestart = input.restartSourceRefs?.has(sourceRef) ?? false;

    if (forceRestart) {
      rmSync(partPath, { force: true });
      rmSync(finalPath, { force: true });
    }

    if (!forceRestart && existsSync(finalPath) && (item.size ?? 0) > 0) {
      const current = statSync(finalPath).size;
      if (current === item.size) {
        input.emit?.({
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
        input.emit?.({
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
  input.emit?.({ type: "status", payload: { isSyncing: false, phase: "idle" } });
}

async function applyNodeEvent(input: {
  mount: VfsMount;
  provider: VfsProviderAdapter;
  repository: VfsRepository;
  contentRootParent: string;
  nowMs: () => number;
  logger: Logger;
  emit?: (event: VfsSyncerEvent) => void;
  event: VfsNodeEventRow;
  allowContentSync?: boolean;
}): Promise<void> {
  const preserveDbNameOnSync =
    input.mount.providerType === "local" &&
    (input.mount.providerExtra.syncName === false ||
      input.mount.providerExtra.syncName === "false");
  input.logger.info(
    {
      mountId: input.mount.mountId,
      type: input.event.type === "delete" ? "delete" : "upsert",
      id: input.event.sourceRef,
    },
    "syncer watch event received"
  );
  const now = input.nowMs();
  const prev = input.repository.getNodeByMountNodeIdAndSourceRef(
    input.mount.mountId,
    input.event.sourceRef
  );

  if (input.event.type === "delete") {
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
    input.emit?.({
      type: "metadata_progress",
      payload: { total: 1, processed: 1, added: 0, updated: 0, deleted: 1 },
    });
    return;
  }

  let enriched = input.event.node;
  if (!enriched) {
    const fetched = await input.provider.getMetadata({
      id: input.event.sourceRef,
    });
    if (fetched) {
      enriched = fetched;
    }
  }
  if (enriched) {
    enriched = await enrichMetadataIfNeeded(
      input.event.node
        ? {
            ...enriched,
            nodeId: enriched.sourceRef,
          }
        : enriched,
      input.provider,
      ["providerVersion"]
    );
  }
  if (!enriched) {
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
    input.emit?.({
      type: "metadata_progress",
      payload: { total: 1, processed: 1, added: 0, updated: 0, deleted: 1 },
    });
    return;
  }
  const node = toNode(input.mount, enriched, now);
  if (prev) {
    node.createdAtMs = prev.createdAtMs;
    if (preserveDbNameOnSync) {
      node.name = prev.name;
    }
  }
  input.repository.upsertNodes([node]);
  input.emit?.({
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
    input.allowContentSync !== false &&
    input.mount.syncContent &&
    input.provider.createReadStream &&
    enriched.kind === "file" &&
    (input.event.type === "add" ||
      input.event.type === "update_content" ||
      !prev ||
      prev.deletedAtMs !== null ||
      prev.size !== node.size ||
      prev.mtimeMs !== node.mtimeMs ||
      prev.providerVersion !== node.providerVersion ||
      !existsSync(
        join(input.contentRootParent, input.mount.mountId, ...enriched.sourceRef.split("/"))
      ));
  if (!shouldSyncSingle) {
    return;
  }

  const restartSourceRefs = new Set<string>();
  if (prev && prev.providerVersion !== node.providerVersion) {
    restartSourceRefs.add(enriched.sourceRef);
  }
  await syncContent({
    mount: input.mount,
    provider: input.provider,
    contentRootParent: input.contentRootParent,
    emit: input.emit,
    items: [enriched],
    restartSourceRefs,
  });
}

async function applyDeleteEventWithoutMount(input: {
  repository: VfsRepository;
  nowMs: () => number;
  emit?: (event: VfsSyncerEvent) => void;
  event: VfsNodeEventRow;
}): Promise<void> {
  const prev = input.repository.getNodeByMountNodeIdAndSourceRef(input.event.mountId, input.event.sourceRef);
  if (!prev || prev.deletedAtMs !== null) {
    return;
  }
  const now = input.nowMs();
  input.repository.upsertNodes([
    {
      ...prev,
      deletedAtMs: now,
      updatedAtMs: now,
    },
  ]);
  input.emit?.({
    type: "metadata_progress",
    payload: { total: 1, processed: 1, added: 0, updated: 0, deleted: 1 },
  });
}

function queueMountIds(rows: VfsNodeEventRow[]): string[] {
  return [...new Set(rows.map((row) => row.mountId))];
}

async function drainNodeEvents(input: {
  repository: VfsRepository;
  contentRootParent: string;
  resolveMount: (mountId: string) => VfsMount | null;
  resolveProvider: (mount: VfsMount) => VfsProviderAdapter;
  hooks?: VfsSyncerHookRunner;
  nowMs: () => number;
  logger: Logger;
  emitSyncerEvent?: (mountId: string, event: VfsSyncerEvent) => void;
  batchSize: number;
  allowContentSync: boolean;
  types: VfsNodeEventProcessorType[];
}): Promise<{ blocked: boolean }> {
  while (true) {
    const rows = input.repository.listNodeEvents({
      limit: input.batchSize,
      types: input.types,
    });
    if (rows.length === 0) {
      return { blocked: false };
    }
    for (const mountId of queueMountIds(rows)) {
      input.emitSyncerEvent?.(mountId, {
        type: "queue_progress",
        payload: input.repository.getQueueProgressByMountId(mountId),
      });
    }
    for (const event of rows) {
      const mount = input.resolveMount(event.mountId);
      const prevNode = input.repository.getNodeByMountNodeIdAndSourceRef(event.mountId, event.sourceRef);
      const beforeHookName = toBeforeHookName(event.type);
      const afterHookName = toAfterHookName(event.type);
      try {
        if (!mount && event.type !== "delete") {
          input.logger.info(
            { mountId: event.mountId, sourceRef: event.sourceRef, eventType: event.type },
            "dropping node event because mount config is missing"
          );
          input.repository.deleteNodeEvents([{ id: event.id, mountId: event.mountId }]);
          input.emitSyncerEvent?.(event.mountId, {
            type: "queue_progress",
            payload: input.repository.getQueueProgressByMountId(event.mountId),
          });
          continue;
        }
        try {
          await input.hooks?.beforeNodeEvent?.(beforeHookName, {
            mount,
            event,
            prevNode,
            nextNode: null,
          } satisfies VfsNodeEventHookContext);
        } catch (error) {
          throw new BlockingHookError(`${beforeHookName} failed`, error);
        }
        if (mount) {
          await applyNodeEvent({
            mount,
            provider: input.resolveProvider(mount),
            repository: input.repository,
            contentRootParent: input.contentRootParent,
            nowMs: input.nowMs,
            logger: input.logger,
            emit(eventToEmit) {
              input.emitSyncerEvent?.(event.mountId, eventToEmit);
            },
            event,
            allowContentSync: input.allowContentSync,
          });
        } else {
          await applyDeleteEventWithoutMount({
            repository: input.repository,
            nowMs: input.nowMs,
            emit(eventToEmit) {
              input.emitSyncerEvent?.(event.mountId, eventToEmit);
            },
            event,
          });
        }
        try {
          await input.hooks?.afterNodeEvent?.(afterHookName, {
            mount,
            event,
            prevNode,
            nextNode: input.repository.getNodeByMountNodeIdAndSourceRef(event.mountId, event.sourceRef),
          } satisfies VfsNodeEventHookContext);
        } catch (error) {
          input.logger.warn(
            {
              mountId: event.mountId,
              sourceRef: event.sourceRef,
              eventType: event.type,
              hookName: afterHookName,
              stage: "after",
              error: String(error),
            },
            "syncer event hook failed"
          );
        }
      } catch (error) {
        if (error instanceof BlockingHookError) {
          input.logger.warn(
            {
              mountId: event.mountId,
              sourceRef: event.sourceRef,
              eventType: event.type,
              hookName: beforeHookName,
              stage: "before",
              error: String(error.causeValue ?? error),
            },
            "syncer nodeEvents handler blocked by hook"
          );
          input.emitSyncerEvent?.(event.mountId, {
            type: "queue_progress",
            payload: input.repository.getQueueProgressByMountId(event.mountId),
          });
          return { blocked: true };
        }
        input.logger.warn(
          {
            mountId: event.mountId,
            sourceRef: event.sourceRef,
            error: String(error),
          },
          "syncer nodeEvents handler failed"
        );
        input.repository.deleteNodeEvents([{ id: event.id, mountId: event.mountId }]);
        input.emitSyncerEvent?.(event.mountId, {
          type: "queue_progress",
          payload: input.repository.getQueueProgressByMountId(event.mountId),
        });
        continue;
      }
      input.repository.deleteNodeEvents([{ id: event.id, mountId: event.mountId }]);
      input.emitSyncerEvent?.(event.mountId, {
        type: "queue_progress",
        payload: input.repository.getQueueProgressByMountId(event.mountId),
      });
    }
  }
}

function createFilteredVfsNodeEventsProcessor(input: {
  repository: VfsRepository;
  contentRootParent: string;
  resolveMount: (mountId: string) => VfsMount | null;
  resolveProvider: (mount: VfsMount) => VfsProviderAdapter;
  hooks?: VfsSyncerHookRunner;
  nowMs?: () => number;
  logger?: Logger;
  emitSyncerEvent?: (mountId: string, event: VfsSyncerEvent) => void;
  batchSize?: number;
  idleMs?: number;
  allowContentSync: boolean;
  types: VfsNodeEventProcessorType[];
}): VfsNodeEventsProcessor {
  const nowMs = input.nowMs ?? (() => Date.now());
  const logger =
    input.logger ??
    pino({
      name: "knowdisk.vfs.syncer",
    });
  const batchSize = input.batchSize ?? 200;
  const idleMs = input.idleMs ?? 1200;
  let started = false;
  let running = false;
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;
  let stopSub: (() => void) | null = null;

  const scheduleSlowScan = (): void => {
    if (!started || wakeTimer) {
      return;
    }
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      trigger(false);
    }, idleMs);
  };

  const trigger = (immediate = false): void => {
    if (!started) {
      return;
    }
    if (immediate && wakeTimer) {
      clearTimeout(wakeTimer);
      wakeTimer = null;
    }
    if (running) {
      return;
    }
    void run();
  };

  const drain = async (options?: { allowContentSync?: boolean }): Promise<{ blocked: boolean }> => {
    return drainNodeEvents({
      repository: input.repository,
      contentRootParent: input.contentRootParent,
      resolveMount: input.resolveMount,
      resolveProvider: input.resolveProvider,
      hooks: input.hooks,
      nowMs,
      logger,
      emitSyncerEvent: input.emitSyncerEvent,
      batchSize,
      allowContentSync: options?.allowContentSync ?? input.allowContentSync,
      types: input.types,
    });
  };

  const run = async (): Promise<void> => {
    if (running || !started) {
      return;
    }
    running = true;
    try {
      while (true) {
        const result = await drain();
        if (result.blocked || input.repository.listNodeEvents({ limit: 1, types: input.types }).length === 0) {
          break;
        }
      }
    } finally {
      running = false;
      if (!started) {
        return;
      }
      scheduleSlowScan();
    }
  };

  return {
    start() {
      if (started) {
        return;
      }
      started = true;
      stopSub = input.repository.subscribeNodeEventsChanged((mountId) => {
        input.emitSyncerEvent?.(mountId, {
          type: "queue_progress",
          payload: input.repository.getQueueProgressByMountId(mountId),
        });
        trigger(true);
      });
      trigger(true);
    },

    close() {
      started = false;
      if (stopSub) {
        stopSub();
        stopSub = null;
      }
      if (wakeTimer) {
        clearTimeout(wakeTimer);
        wakeTimer = null;
      }
    },

    drain,
  };
}

export function createVfsMetadataNodeEventsProcessor(
  input: Omit<Parameters<typeof createFilteredVfsNodeEventsProcessor>[0], "allowContentSync" | "types">
): VfsNodeEventsProcessor {
  return createFilteredVfsNodeEventsProcessor({
    ...input,
    allowContentSync: false,
    types: ["add", "update_metadata", "delete"],
  });
}

export function createVfsContentNodeEventsProcessor(
  input: Omit<Parameters<typeof createFilteredVfsNodeEventsProcessor>[0], "allowContentSync" | "types">
): VfsNodeEventsProcessor {
  return createFilteredVfsNodeEventsProcessor({
    ...input,
    allowContentSync: true,
    types: ["update_content"],
  });
}
