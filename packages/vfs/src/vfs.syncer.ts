import pino, { type Logger } from "pino";
import { createVfsNodeId } from "./vfs.node-id";
import type { VfsProviderAdapter } from "./vfs.provider.types";
import { walk } from "./vfs.provider.walk";
import type { VfsNodeEventRow, VfsRepository } from "./vfs.repository.types";
import type { VfsChangeEvent, VfsNodeEventHookContext } from "./vfs.service.types";
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
      type: "queue_progress";
      payload: {
        pendingUnits: number;
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
  beforeNodeEvent?: (hookName: VfsNodeEventHookName, ctx: VfsNodeEventHookContext) => Promise<void>;
  afterNodeEvent?: (hookName: VfsNodeEventHookName, ctx: VfsNodeEventHookContext) => Promise<void>;
};

type VfsNodeEventHookName =
  | "beforeAdd"
  | "afterAdd"
  | "beforeUpdateMetadata"
  | "afterUpdateMetadata"
  | "beforeUpdateContent"
  | "afterUpdateContent"
  | "beforeDelete"
  | "afterDelete";

export function createVfsSyncer(input: {
  mount: VfsMount;
  provider: VfsProviderAdapter;
  repository: VfsRepository;
  contentRootParent: string;
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

  const emit = (event: VfsSyncerEvent) => {
    if (event.type === "status") {
      logger.info(
        {
          mountId: input.mount.mountId,
          phase: event.payload.phase,
          isSyncing: event.payload.isSyncing,
        },
        "syncer status changed"
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
    }
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

  return {
    async fullSync() {
      emit({ type: "status", payload: { isSyncing: true, phase: "metadata" } });
      const now = nowMs();
      const existing = input.repository.listNodesByMountNodeId(input.mount.mountId);
      const existingByRef = new Map(existing.map((node) => [node.sourceRef, node]));

      const walkedItems = await walk({
        provider: input.provider,
        requiredFields: MetadataAllField,
      });
      logger.info(
        { mountId: input.mount.mountId, discoveredCount: walkedItems.length },
        "syncer discovered remote metadata"
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
          (node) => node.kind !== "mount" && node.deletedAtMs === null && !seen.has(node.sourceRef)
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
        "syncer metadata reconcile completed"
      );
      emit({ type: "status", payload: { isSyncing: false, phase: "idle" } });
    },

    async startWatching() {
      if (!input.provider.watch || watchClose) {
        return;
      }
      logger.info({ mountId: input.mount.mountId }, "syncer watch started");
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
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
