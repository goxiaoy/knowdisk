import { existsSync, createWriteStream, rmSync, statSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import pino, { type Logger } from "pino";
import { enrichMetadataIfNeeded, walk } from "./vfs.provider.walk";
import { createVfsNodeId } from "./vfs.node-id";
import type { VfsProviderAdapter } from "./vfs.provider.types";
import type { VfsNodeEventRow, VfsRepository } from "./vfs.repository.types";
import type {
  VfsChangeEvent,
  VfsNodeEventHookContext,
  VfsSyncContentHookContext,
} from "./vfs.service.types";
import { MetadataAllField, type VfsMount, type VfsNode } from "./vfs.types";

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

export type VfsSyncerHookRunner = {
  beforeNodeEvent?: (
    hookName: `before_${VfsNodeEventRow["type"]}`,
    ctx: VfsNodeEventHookContext,
  ) => Promise<void>;
  afterNodeEvent?: (
    hookName: `after_${VfsNodeEventRow["type"]}`,
    ctx: VfsNodeEventHookContext,
  ) => Promise<void>;
  beforeSyncContent?: (ctx: VfsSyncContentHookContext) => Promise<void>;
  afterSyncContent?: (ctx: VfsSyncContentHookContext) => Promise<void>;
};

export function createVfsSyncer(input: {
  mount: VfsMount;
  provider: VfsProviderAdapter;
  repository: VfsRepository;
  contentRootParent: string;
  hooks?: VfsSyncerHookRunner;
  nowMs?: () => number;
  logger?: Logger;
}): VfsSyncer {
  type NodeEventInsertRow = Omit<VfsNodeEventRow, "id">;
  const nowMs = input.nowMs ?? (() => Date.now());
  const logger =
    input.logger ??
    pino({
      name: "knowdisk.vfs.syncer",
    });
  const listeners = new Set<(event: VfsSyncerEvent) => void>();
  let watchClose: (() => Promise<void>) | null = null;
  let watchQueue: Promise<void> = Promise.resolve();
  let stopNodeEventsSub: (() => void) | null = null;
  let nodeEventsRunning = false;
  let nodeEventsRunPromise: Promise<void> | null = null;
  let nodeEventsWakeTimer: ReturnType<typeof setTimeout> | null = null;
  let nodeEventsImmediateRequested = false;
  let nodeEventsSubscribed = false;
  const NODE_EVENTS_BATCH = 200;
  const NODE_EVENTS_IDLE_MS = 1200;
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

  const itemSourceRef = (item: VfsNode): string => item.sourceRef;

  const sourceRefParent = (sourceRef: string): string | null => {
    const parts = sourceRef.split("/").filter((part) => part.length > 0);
    if (parts.length <= 1) {
      return null;
    }
    return parts.slice(0, parts.length - 1).join("/");
  };
  const preserveDbNameOnSync =
    input.mount.providerType === "local" &&
    (input.mount.providerExtra.syncName === false ||
      input.mount.providerExtra.syncName === "false");

  function toNode(item: VfsNode, now: number): VfsNode {
    const nodeId = createVfsNodeId({
      mountId: input.mount.mountId,
      sourceRef: itemSourceRef(item),
    });
    const parentSourceRef = sourceRefParent(itemSourceRef(item));
    const parentId = parentSourceRef
      ? createVfsNodeId({
          mountId: input.mount.mountId,
          sourceRef: parentSourceRef,
        })
      : createVfsNodeId({
          mountId: input.mount.mountId,
          sourceRef: "",
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
    items: VfsNode[],
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
      const finalPath = join(
        input.contentRootParent,
        input.mount.mountId,
        ...sourceRef.split("/"),
      );
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
      const existingByRef = new Map(
        existing.map((node) => [node.sourceRef, node]),
      );

      const walkedItems = await walk({
        provider: input.provider,
        requiredFields: MetadataAllField,
      });
      logger.info(
        { mountId: input.mount.mountId, discoveredCount: walkedItems.length },
        "syncer discovered remote metadata",
      );

      let processed = 0;
      let added = 0;
      let updated = 0;
      const eventRows: NodeEventInsertRow[] = [];
      for (const item of walkedItems) {
        const node = toNode(item, now);
        const prev = existingByRef.get(node.sourceRef);
        if (prev && preserveDbNameOnSync) {
          node.name = prev.name;
        }
        if (!prev) {
          added += 1;
          appendNodeEventsFromDiff(eventRows, {
            sourceRef: node.sourceRef,
            parentId: node.parentId,
            createdAtMs: now,
            kind: "add",
            node,
          });
        } else if (
          prev.deletedAtMs !== null ||
          prev.name !== node.name ||
          prev.kind !== node.kind ||
          prev.size !== node.size ||
          prev.mtimeMs !== node.mtimeMs ||
          prev.providerVersion !== node.providerVersion
        ) {
          updated += 1;
          const shouldEmitContentUpdate =
            prev.deletedAtMs !== null ||
            prev.size !== node.size ||
            prev.mtimeMs !== node.mtimeMs ||
            prev.providerVersion !== node.providerVersion;
          appendNodeEventsFromDiff(eventRows, {
            sourceRef: node.sourceRef,
            parentId: node.parentId,
            createdAtMs: now,
            kind: "update",
            metadataChanged: true,
            contentChanged: shouldEmitContentUpdate,
            node,
          });
          node.createdAtMs = prev.createdAtMs;
        } else {
          node.createdAtMs = prev.createdAtMs;
        }
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
      for (const node of deletedRows) {
        appendNodeEventsFromDiff(eventRows, {
          sourceRef: node.sourceRef,
          parentId: node.parentId,
          createdAtMs: now,
          kind: "delete",
          node,
        });
      }
      if (eventRows.length > 0) {
        input.repository.insertNodeEvents(eventRows);
      }
      await runNodeEventsHandler({
        allowContentSync: false,
        includeContentUpdates: false,
      });
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
      emit({ type: "status", payload: { isSyncing: false, phase: "idle" } });
    },

    async startWatching() {
      if (!input.provider.watch || watchClose) {
        return;
      }
      logger.info({ mountId: input.mount.mountId }, "syncer watch started");
      ensureNodeEventsSubscription();
      triggerNodeEventsScan(true);
      const active = await input.provider.watch({
        onEvent: (event) => {
          watchQueue = watchQueue
            .then(async () => {
              emit({
                type: "status",
                payload: { isSyncing: true, phase: "metadata" },
              });
              await handleWatchEvent(event);
              emit({
                type: "status",
                payload: { isSyncing: false, phase: "idle" },
              });
            })
            .catch(() => {
              emit({
                type: "status",
                payload: { isSyncing: false, phase: "idle" },
              });
            });
        },
      });
      watchClose = active.close;
    },

    async stopWatching() {
      if (watchClose) {
        await watchQueue;
        await watchClose();
        watchClose = null;
        logger.info({ mountId: input.mount.mountId }, "syncer watch stopped");
      }
      if (stopNodeEventsSub) {
        stopNodeEventsSub();
        stopNodeEventsSub = null;
      }
      nodeEventsSubscribed = false;
      nodeEventsImmediateRequested = false;
      if (nodeEventsWakeTimer) {
        clearTimeout(nodeEventsWakeTimer);
        nodeEventsWakeTimer = null;
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  function ensureNodeEventsSubscription(): void {
    if (stopNodeEventsSub) {
      return;
    }
    nodeEventsSubscribed = true;
    stopNodeEventsSub = input.repository.subscribeNodeEventsQueued(() => {
      if (!nodeEventsRunning) {
        triggerNodeEventsScan(true);
      }
    });
  }

  function triggerNodeEventsScan(immediate = false): void {
    if (immediate) {
      nodeEventsImmediateRequested = true;
      if (nodeEventsWakeTimer) {
        clearTimeout(nodeEventsWakeTimer);
        nodeEventsWakeTimer = null;
      }
    }
    if (nodeEventsRunning) {
      return;
    }
    const runPromise = runNodeEventsHandler();
    nodeEventsRunPromise = runPromise.finally(() => {
      if (nodeEventsRunPromise === runPromise) {
        nodeEventsRunPromise = null;
      }
    });
  }

  function scheduleNodeEventsSlowScan(): void {
    if (nodeEventsWakeTimer) {
      return;
    }
    nodeEventsWakeTimer = setTimeout(() => {
      nodeEventsWakeTimer = null;
      triggerNodeEventsScan(false);
    }, NODE_EVENTS_IDLE_MS);
  }

  async function runNodeEventsHandler(options?: {
    allowContentSync?: boolean;
    includeContentUpdates?: boolean;
  }): Promise<void> {
    if (nodeEventsRunning) {
      return;
    }
    nodeEventsRunning = true;
    try {
      while (true) {
        const rows = input.repository
          .listNodeEventsByMountId(input.mount.mountId, NODE_EVENTS_BATCH)
          .filter(
            (row) =>
              options?.includeContentUpdates !== false ||
              row.type !== "update_content",
          );
        if (rows.length === 0) {
          break;
        }
        for (const event of rows) {
          const prevNode = input.repository.listNodesByMountIdAndSourceRef(
            input.mount.mountId,
            event.sourceRef,
          );
          try {
            await input.hooks?.beforeNodeEvent?.(`before_${event.type}`, {
              mount: input.mount,
              event,
              prevNode,
              nextNode: null,
            });
            await applyNodeEvent(event, {
              allowContentSync: options?.allowContentSync,
            });
            await input.hooks?.afterNodeEvent?.(`after_${event.type}`, {
              mount: input.mount,
              event,
              prevNode,
              nextNode: input.repository.listNodesByMountIdAndSourceRef(
                input.mount.mountId,
                event.sourceRef,
              ),
            });
          } catch (error) {
            logger.warn(
              {
                mountId: input.mount.mountId,
                sourceRef: event.sourceRef,
                error: String(error),
              },
              "syncer nodeEvents handler failed",
            );
          }
          input.repository.deleteNodeEventsByIds([event.id]);
        }
      }
    } finally {
      nodeEventsRunning = false;
      if (nodeEventsImmediateRequested && nodeEventsSubscribed) {
        nodeEventsImmediateRequested = false;
        triggerNodeEventsScan(false);
      } else if (nodeEventsSubscribed) {
        scheduleNodeEventsSlowScan();
      } else {
        nodeEventsImmediateRequested = false;
      }
    }
  }

  async function applyNodeEvent(
    event: {
      id: string;
      sourceRef: string;
      mountId: string;
      parentId: string | null;
      type: "add" | "update_metadata" | "update_content" | "delete";
      node: VfsNode | null;
      createdAtMs: number;
    },
    options?: { allowContentSync?: boolean },
  ): Promise<void> {
    logger.info(
      {
        mountId: input.mount.mountId,
        type: event.type === "delete" ? "delete" : "upsert",
        id: event.sourceRef,
      },
      "syncer watch event received",
    );
    const now = nowMs();
    const prev = input.repository.listNodesByMountIdAndSourceRef(
      input.mount.mountId,
      event.sourceRef,
    );

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

    //enrich
    let enriched = event.node;
    if (!enriched) {
      const fetched = await input.provider.getMetadata({
        id: event.sourceRef,
      });
      if (fetched) {
        enriched = fetched;
      }
    }
    if (enriched) {
      //enrich provider version
      enriched = await enrichMetadataIfNeeded(
        event.node
          ? {
              ...enriched,
              nodeId: enriched.sourceRef,
            }
          : enriched,
        input.provider,
        ["providerVersion"],
      );
    }
    if (!enriched) {
      //deleted
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
    const node = toNode(enriched, now);
    if (prev) {
      node.createdAtMs = prev.createdAtMs;
      if (preserveDbNameOnSync) {
        node.name = prev.name;
      }
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
      options?.allowContentSync !== false &&
      input.mount.syncContent &&
      input.provider.createReadStream &&
      enriched.kind === "file" &&
      (event.type === "add" ||
        event.type === "update_content" ||
        !prev ||
        prev.deletedAtMs !== null ||
        prev.size !== node.size ||
        prev.mtimeMs !== node.mtimeMs ||
        prev.providerVersion !== node.providerVersion ||
        !existsSync(
          join(
            input.contentRootParent,
            input.mount.mountId,
            ...enriched.sourceRef.split("/"),
          ),
        ));
    if (!shouldSyncSingle) {
      return;
    }

    const restartSourceRefs = new Set<string>();
    if (prev && prev.providerVersion !== node.providerVersion) {
      restartSourceRefs.add(enriched.sourceRef);
    }
    await syncContent([enriched], { restartSourceRefs });
  }

  async function handleWatchEvent(event: VfsChangeEvent): Promise<void> {
    const createdAtMs = nowMs();
    const rows: NodeEventInsertRow[] = [];
    if (event.type === "delete") {
      appendNodeEventsFromDiff(rows, {
        sourceRef: event.id,
        parentId: event.parentId,
        createdAtMs,
        kind: "delete",
      });
    } else if (event.type === "add") {
      appendNodeEventsFromDiff(rows, {
        sourceRef: event.id,
        parentId: event.parentId,
        createdAtMs,
        kind: "add",
      });
    } else if (event.type === "update") {
      appendNodeEventsFromDiff(rows, {
        sourceRef: event.id,
        parentId: event.parentId,
        createdAtMs,
        kind: "update",
        metadataChanged: event.metadataChanged !== false,
        contentChanged: event.contentUpdated !== false,
      });
    }
    input.repository.insertNodeEvents(rows);
  }

  function appendNodeEventsFromDiff(
    target: NodeEventInsertRow[],
    inputDiff: {
      sourceRef: string;
      parentId: string | null;
      createdAtMs: number;
      kind: "add" | "update" | "delete";
      metadataChanged?: boolean;
      contentChanged?: boolean;
      node?: VfsNode | null;
    },
  ): void {
    const makeRow = (type: NodeEventInsertRow["type"]): NodeEventInsertRow => ({
      sourceRef: inputDiff.sourceRef,
      mountId: input.mount.mountId,
      parentId: inputDiff.parentId,
      type,
      node: inputDiff.node ?? null,
      createdAtMs: inputDiff.createdAtMs,
    });

    if (inputDiff.kind === "delete") {
      target.push(makeRow("delete"));
      return;
    }
    if (inputDiff.kind === "add") {
      target.push(makeRow("add"));
      target.push(makeRow("update_metadata"));
      target.push(makeRow("update_content"));
      return;
    }
    if (inputDiff.metadataChanged !== false) {
      target.push(makeRow("update_metadata"));
    }
    if (inputDiff.contentChanged !== false) {
      target.push(makeRow("update_content"));
    }
  }
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
      } as unknown as Parameters<
        NonNullable<typeof input.provider.createReadStream>
      >[0]);
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
