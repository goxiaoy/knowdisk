import { randomUUID } from "node:crypto";
import {
  decodeVfsCursorToken,
  encodeVfsLocalCursorToken,
  encodeVfsRemoteCursorToken,
} from "./vfs.cursor";
import { createVfsNodeId } from "./vfs.node-id";
import type { VfsProviderRegistry } from "./vfs.provider.registry";
import type { VfsRepository } from "./vfs.repository.types";
import { createVfsSyncer, type VfsSyncer } from "./vfs.syncer";
import type { VfsChangeEvent, VfsService } from "./vfs.service.types";
import type {
  VfsMount,
  VfsMountConfig,
  VfsNode,
  WalkChildrenInput,
  WalkChildrenOutput,
} from "./vfs.types";

export function createVfsService(deps: {
  repository: VfsRepository;
  registry: VfsProviderRegistry;
  contentRootParent?: string;
  nowMs?: () => number;
}): VfsService {
  const nowMs = deps.nowMs ?? (() => Date.now());
  let started = false;
  const reconcileTimers = new Map<string, ReturnType<typeof setInterval>>();
  const reconcileRunning = new Set<string>();
  const listeners = new Set<(event: VfsChangeEvent) => void>();
  const syncers = new Map<
    string,
    { mount: VfsMount; syncer: VfsSyncer; stopSub: () => void }
  >();
  deps.repository.subscribeNodeChanges((changes) => {
    const touchedMountIds = new Set<string>();
    for (const change of changes) {
      touchedMountIds.add(change.next.mountId);
      if (change.prev) {
        touchedMountIds.add(change.prev.mountId);
      }
    }
    for (const mountId of touchedMountIds) {
      deps.repository.deletePageCacheByMountId(mountId);
    }
    for (const change of changes) {
      const event = toChangeEvent(change.prev, change.next);
      if (!event) {
        continue;
      }
      for (const listener of listeners) {
        listener(event);
      }
    }
  });

  const mountFromExt = (ext: ReturnType<VfsRepository["getNodeMountExtByMountId"]>): VfsMount => {
    if (!ext) {
      throw new Error("mount config not found");
    }
    return {
      mountId: ext.mountId,
      providerType: ext.providerType,
      providerExtra: ext.providerExtra,
      autoSync: ext.autoSync !== false,
      syncMetadata: ext.syncMetadata,
      syncContent: ext.syncContent,
      metadataTtlSec: ext.metadataTtlSec,
      reconcileIntervalMs: ext.reconcileIntervalMs,
    };
  };

  const isAutoSyncEnabled = (mount: VfsMount): boolean => mount.autoSync !== false;

  const ensureSyncer = async (mount: VfsMount): Promise<VfsSyncer> => {
    const existing = syncers.get(mount.mountId);
    if (existing) {
      return existing.syncer;
    }
    if (!deps.contentRootParent) {
      throw new Error("contentRootParent is required when starting vfs runtime");
    }
    const syncer = createVfsSyncer({
      mount,
      provider: deps.registry.get(mount),
      repository: deps.repository,
      contentRootParent: deps.contentRootParent,
      nowMs,
    });
    const stopSub = syncer.subscribe(() => {});
    syncers.set(mount.mountId, { mount, syncer, stopSub });
    return syncer;
  };

  const startSyncer = async (mount: VfsMount): Promise<void> => {
    const syncer = await ensureSyncer(mount);
    await syncer.startWatching();
    void syncer.fullSync().catch(() => {});
  };

  const stopSyncer = async (mountId: string): Promise<void> => {
    const active = syncers.get(mountId);
    if (!active) {
      return;
    }
    await active.syncer.stopWatching();
    active.stopSub();
    syncers.delete(mountId);
  };

  const clearReconcileTimer = (mountId: string): void => {
    const timer = reconcileTimers.get(mountId);
    if (!timer) {
      return;
    }
    clearInterval(timer);
    reconcileTimers.delete(mountId);
  };

  const scheduleReconcile = (mount: VfsMount): void => {
    clearReconcileTimer(mount.mountId);
    if (!started || !isAutoSyncEnabled(mount) || mount.reconcileIntervalMs <= 0) {
      return;
    }
    const timer = setInterval(() => {
      void runReconcile(mount.mountId).catch(() => {});
    }, mount.reconcileIntervalMs);
    reconcileTimers.set(mount.mountId, timer);
  };

  const runReconcile = async (mountId: string): Promise<void> => {
    if (reconcileRunning.has(mountId)) {
      return;
    }
    reconcileRunning.add(mountId);
    try {
      const active = syncers.get(mountId);
      if (active) {
        await active.syncer.fullSync();
        return;
      }
      if (!deps.contentRootParent) {
        return;
      }
      const ext = deps.repository.getNodeMountExtByMountId(mountId);
      if (!ext) {
        return;
      }
      const mount = mountFromExt(ext);
      if (!isAutoSyncEnabled(mount)) {
        return;
      }
      const syncer = await ensureSyncer(mount);
      try {
        await syncer.fullSync();
      } finally {
        if (!started) {
          await stopSyncer(mountId);
        }
      }
    } finally {
      reconcileRunning.delete(mountId);
    }
  };

  return {
    async watch(input) {
      listeners.add(input.onEvent);
      return {
        close: async () => {
          listeners.delete(input.onEvent);
        },
      };
    },

    async start() {
      if (started) {
        return;
      }
      started = true;
      const mounts = deps.repository.listNodeMountExts().map((ext) => mountFromExt(ext));
      for (const mount of mounts) {
        if (!isAutoSyncEnabled(mount)) {
          clearReconcileTimer(mount.mountId);
          continue;
        }
        try {
          await startSyncer(mount);
        } catch {
          // keep runtime alive; reconcile timer will retry
        }
        scheduleReconcile(mount);
      }
    },

    async close() {
      for (const mountId of [...reconcileTimers.keys()]) {
        clearReconcileTimer(mountId);
      }
      const ids = [...syncers.keys()];
      for (const id of ids) {
        await stopSyncer(id);
      }
      started = false;
    },

    async mount(config: VfsMountConfig) {
      return this.mountInternal(randomUUID(), config);
    },

    async mountInternal(mountId: string, config: VfsMountConfig) {
      const mount: VfsMount = {
        mountId,
        ...config,
        autoSync: config.autoSync !== false,
      };
      const now = nowMs();
      const mountNodeId = createVfsNodeId({
        mountId: mount.mountId,
        sourceRef: "",
      });
      deps.repository.upsertNodes([
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
          createdAtMs: now,
          updatedAtMs: now,
        },
      ]);
      deps.repository.upsertNodeMountExt({
        nodeId: mountNodeId,
        mountId: mount.mountId,
        providerType: mount.providerType,
        providerExtra: mount.providerExtra,
        autoSync: mount.autoSync !== false,
        syncMetadata: mount.syncMetadata,
        syncContent: mount.syncContent ?? false,
        metadataTtlSec: mount.metadataTtlSec,
        reconcileIntervalMs: mount.reconcileIntervalMs,
        createdAtMs: now,
        updatedAtMs: now,
      });
      if (started) {
        if (isAutoSyncEnabled(mount)) {
          try {
            await startSyncer(mount);
          } catch {
            // keep runtime alive; reconcile timer will retry
          }
          scheduleReconcile(mount);
        } else {
          clearReconcileTimer(mount.mountId);
          await stopSyncer(mount.mountId);
        }
      }
      return mount;
    },

    async unmount(mountId: string) {
      clearReconcileTimer(mountId);
      await stopSyncer(mountId);
      const now = nowMs();
      const rows = deps.repository
        .listNodesByMountId(mountId)
        .filter((node) => node.deletedAtMs === null)
        .map((node) => ({
          ...node,
          deletedAtMs: now,
          updatedAtMs: now,
        }));
      if (rows.length > 0) {
        deps.repository.upsertNodes(rows);
      }
      deps.repository.deleteNodeMountExtByMountId(mountId);
    },

    async listChildren(input) {
      if (input.parentId === null) {
        throw new Error(
          "listChildren requires parentId; use walkChildren for root listing",
        );
      }
      const parentNode = deps.repository.getNodeById(input.parentId);
      if (!parentNode) {
        throw new Error(`Parent node not found: ${input.parentId}`);
      }
      const ext = deps.repository.getNodeMountExtByMountId(parentNode.mountId);
      if (!ext) {
        throw new Error(`Mount config not found: ${parentNode.mountId}`);
      }
      const mount: VfsMount = {
        mountId: ext.mountId,
        providerType: ext.providerType,
        providerExtra: ext.providerExtra,
        autoSync: ext.autoSync !== false,
        syncMetadata: ext.syncMetadata,
        syncContent: ext.syncContent,
        metadataTtlSec: ext.metadataTtlSec,
        reconcileIntervalMs: ext.reconcileIntervalMs,
      };
      return deps.registry.get(mount).listChildren(input);
    },

    async createReadStream(input) {
      throw new Error(
        `VfsService createReadStream is not supported: ${input.id}`,
      );
    },

    async walkChildren(input: WalkChildrenInput): Promise<WalkChildrenOutput> {
      if (input.parentNodeId === null) {
        return walkLocalChildren({
          repository: deps.repository,
          limit: input.limit,
          cursorToken: input.cursor?.token,
        });
      }
      const parentNode = deps.repository.getNodeById(input.parentNodeId);
      if (!parentNode) {
        throw new Error(`Parent node not found: ${input.parentNodeId}`);
      }
      const ext = deps.repository.getNodeMountExtByMountId(parentNode.mountId);
      if (!ext) {
        throw new Error(`Mount config not found: ${parentNode.mountId}`);
      }
      const resolvedMount: VfsMount = {
        mountId: ext.mountId,
        providerType: ext.providerType,
        providerExtra: ext.providerExtra,
        autoSync: ext.autoSync !== false,
        syncMetadata: ext.syncMetadata,
        syncContent: ext.syncContent,
        metadataTtlSec: ext.metadataTtlSec,
        reconcileIntervalMs: ext.reconcileIntervalMs,
      };

      if (resolvedMount.syncMetadata) {
        return walkLocalChildren({
          repository: deps.repository,
          mountId: resolvedMount.mountId,
          parentNodeId: parentNode.nodeId,
          limit: input.limit,
          cursorToken: input.cursor?.token,
        });
      }

      const adapter = deps.registry.get(resolvedMount);
      const parentProviderId =
        parentNode.kind === "mount" ? null : parentNode.sourceRef;
      const providerCursor = decodeRemoteCursor(input.cursor?.token);
      const cacheKey = `${resolvedMount.mountId}::${parentNode.nodeId}::${providerCursor ?? ""}::${input.limit}`;
      const cached = deps.repository.getPageCacheIfFresh(cacheKey, nowMs());

      if (cached) {
        return {
          items: JSON.parse(cached.itemsJson) as VfsNode[],
          nextCursor: cached.nextCursor
            ? {
                mode: "remote",
                token: encodeVfsRemoteCursorToken({
                  providerCursor: cached.nextCursor,
                }),
              }
            : undefined,
          source: "remote",
        };
      }

      const listed = await adapter.listChildren({
        parentId: parentProviderId,
        parentSourceRef: parentProviderId,
        limit: input.limit,
        cursor: providerCursor ?? undefined,
      } as unknown as Parameters<typeof adapter.listChildren>[0]);

      const now = nowMs();
      const items = listed.items.map((item) => {
        const sourceRef =
          item.sourceRef ?? (item as unknown as { id?: string }).id ?? "";
        return {
          nodeId: createVfsNodeId({
            mountId: resolvedMount.mountId,
            sourceRef,
          }),
          mountId: resolvedMount.mountId,
          parentId: parentNode.nodeId,
          name: item.name,
          kind: item.kind,
          size: item.size ?? null,
          mtimeMs: item.mtimeMs ?? null,
          sourceRef,
          providerVersion: item.providerVersion ?? null,
          deletedAtMs: null,
          createdAtMs: now,
          updatedAtMs: now,
        } satisfies VfsNode;
      });

      deps.repository.upsertNodes(items);
      deps.repository.upsertPageCache({
        cacheKey,
        itemsJson: JSON.stringify(items),
        nextCursor: listed.nextCursor ?? null,
        expiresAtMs: nowMs() + resolvedMount.metadataTtlSec * 1000,
      });

      return {
        items,
        nextCursor: listed.nextCursor
          ? {
              mode: "remote",
              token: encodeVfsRemoteCursorToken({
                providerCursor: listed.nextCursor,
              }),
            }
          : undefined,
        source: "remote",
      };
    },

    async triggerReconcile(mountId: string) {
      await runReconcile(mountId);
    },
  };
}

function toChangeEvent(prev: VfsNode | null, next: VfsNode): VfsChangeEvent | null {
  if (!prev) {
    return next.deletedAtMs === null
      ? { type: "add", id: next.nodeId, parentId: next.parentId }
      : { type: "delete", id: next.nodeId, parentId: next.parentId };
  }

  if (prev.deletedAtMs === null && next.deletedAtMs !== null) {
    return { type: "delete", id: next.nodeId, parentId: next.parentId };
  }
  if (prev.deletedAtMs !== null && next.deletedAtMs === null) {
    return { type: "add", id: next.nodeId, parentId: next.parentId };
  }
  if (next.deletedAtMs !== null) {
    return null;
  }

  const contentChanged =
    prev.size !== next.size ||
    prev.mtimeMs !== next.mtimeMs ||
    prev.providerVersion !== next.providerVersion;
  if (contentChanged) {
    return { type: "update_content", id: next.nodeId, parentId: next.parentId };
  }

  const metadataChanged =
    prev.parentId !== next.parentId ||
    prev.name !== next.name ||
    prev.kind !== next.kind ||
    prev.mountId !== next.mountId ||
    prev.sourceRef !== next.sourceRef;
  if (metadataChanged) {
    return { type: "update_metadata", id: next.nodeId, parentId: next.parentId };
  }
  return null;
}

function walkLocalChildren(input: {
  repository: VfsRepository;
  mountId?: string;
  parentNodeId?: string | null;
  limit: number;
  cursorToken?: string;
}): WalkChildrenOutput {
  const localCursor = decodeLocalCursor(input.cursorToken);
  const page = input.repository.listChildrenPageLocal({
    mountId: input.mountId,
    parentId: input.parentNodeId ?? null,
    limit: input.limit,
    cursor: localCursor ?? undefined,
  });
  return {
    items: page.items,
    nextCursor: page.nextCursor
      ? {
          mode: "local",
          token: encodeVfsLocalCursorToken(page.nextCursor),
        }
      : undefined,
    source: "local",
  };
}

function decodeLocalCursor(token?: string) {
  if (!token) {
    return null;
  }
  const decoded = decodeVfsCursorToken(token);
  if (decoded.mode !== "local") {
    throw new Error("Expected local cursor token");
  }
  return {
    lastName: decoded.lastName,
    lastNodeId: decoded.lastNodeId,
  };
}

function decodeRemoteCursor(token?: string) {
  if (!token) {
    return null;
  }
  const decoded = decodeVfsCursorToken(token);
  if (decoded.mode !== "remote") {
    throw new Error("Expected remote cursor token");
  }
  return decoded.providerCursor;
}
