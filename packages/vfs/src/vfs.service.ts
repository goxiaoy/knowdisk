import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { join } from "node:path";
import {
  decodeVfsCursorToken,
  encodeVfsLocalCursorToken,
  encodeVfsRemoteCursorToken,
} from "./vfs.cursor";
import { createVfsNodeId } from "./vfs.node-id";
import type { VfsProviderRegistry } from "./vfs.provider.registry";
import type { VfsRepository } from "./vfs.repository.types";
import {
  createVfsSyncer,
  type VfsSyncer,
  type VfsSyncerHookRunner,
} from "./vfs.syncer";
import type { VfsNodeEventHooks, VfsService } from "./vfs.service.types";
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
  logger?: Logger;
}): VfsService {
  const nowMs = deps.nowMs ?? (() => Date.now());
  let started = false;
  const reconcileTimers = new Map<string, ReturnType<typeof setInterval>>();
  const reconcileRunning = new Set<string>();
  const nodeEventHooks = new Map<number, VfsNodeEventHooks>();
  const syncers = new Map<
    string,
    { mount: VfsMount; syncer: VfsSyncer; stopSub: () => void }
  >();
  let nextHookRegistrationId = 1;

  deps.repository.subscribeNodeEventsQueued((row) => {
    deps.repository.deletePageCacheByMountId(row.mountId);
  });

  const mountFromExt = (
    ext: ReturnType<VfsRepository["getNodeMountExtByMountId"]>,
  ): VfsMount => {
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

  const isAutoSyncEnabled = (mount: VfsMount): boolean =>
    mount.autoSync !== false;

  const hooksRunner: VfsSyncerHookRunner = {
    async beforeNodeEvent(hookName, ctx) {
      for (const hooks of nodeEventHooks.values()) {
        await hooks[hookName]?.(ctx);
      }
    },
    async afterNodeEvent(hookName, ctx) {
      for (const hooks of nodeEventHooks.values()) {
        await hooks[hookName]?.(ctx);
      }
    },
  };

  const ensureSyncer = async (mount: VfsMount): Promise<VfsSyncer> => {
    const existing = syncers.get(mount.mountId);
    if (existing) {
      return existing.syncer;
    }
    if (!deps.contentRootParent) {
      throw new Error(
        "contentRootParent is required when starting vfs runtime",
      );
    }
    const syncer = createVfsSyncer({
      mount,
      provider: deps.registry.get(mount),
      repository: deps.repository,
      contentRootParent: deps.contentRootParent,
      hooks: hooksRunner,
      logger: deps.logger,
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
    if (
      !started ||
      !isAutoSyncEnabled(mount) ||
      mount.reconcileIntervalMs <= 0
    ) {
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
    subscribeNodeChanges(listener) {
      return deps.repository.subscribeNodeChanges(listener);
    },

    registerNodeEventHooks(hooks) {
      const id = nextHookRegistrationId;
      nextHookRegistrationId += 1;
      nodeEventHooks.set(id, hooks);
      return () => {
        nodeEventHooks.delete(id);
      };
    },

    async start() {
      if (started) {
        return;
      }
      started = true;
      const mounts = deps.repository
        .listNodeMountExts()
        .map((ext) => mountFromExt(ext));
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
        deps.repository.insertNodeEvents(
          rows.map((row) => ({
            sourceRef: row.sourceRef,
            mountId: row.mountId,
            parentId: row.parentId,
            type: "delete" as const,
            node: null,
            createdAtMs: now,
          })),
        );
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
      const node = deps.repository.getNodeById(input.id);
      if (!node) {
        throw new Error(`Node not found: ${input.id}`);
      }
      if (node.kind !== "file") {
        throw new Error(`Node is not a file: ${input.id}`);
      }
      const ext = deps.repository.getNodeMountExtByMountId(node.mountId);
      if (!ext) {
        throw new Error(`Mount config not found: ${node.mountId}`);
      }
      const mount = mountFromExt(ext);
      if (mount.syncContent) {
        if (!deps.contentRootParent) {
          throw new Error("contentRootParent is required for syncContent reads");
        }
        const localPath = join(
          deps.contentRootParent,
          mount.mountId,
          ...node.sourceRef.split("/"),
        );
        const file = Bun.file(localPath);
        if (input.offset !== undefined || input.length !== undefined) {
          const start = input.offset ?? 0;
          const end =
            input.length === undefined ? undefined : start + input.length;
          return file.slice(start, end).stream();
        }
        return file.stream();
      }
      const provider = deps.registry.get(mount);
      if (!provider.createReadStream) {
        throw new Error(
          `Provider "${mount.providerType}" does not support createReadStream`,
        );
      }
      return provider.createReadStream({
        id: node.sourceRef,
        offset: input.offset,
        length: input.length,
      });
    },

    async getVersion(input) {
      return deps.repository.getNodeById(input.id)?.providerVersion ?? null;
    },

    async getMetadata(input) {
      return deps.repository.getNodeById(input.id);
    },

    async create(input) {
      if (input.parentId === null) {
        throw new Error("Parent node not found: null");
      }
      const parentNode = deps.repository.getNodeById(input.parentId);
      if (!parentNode) {
        throw new Error(`Parent node not found: ${input.parentId}`);
      }
      if (parentNode.kind === "file") {
        throw new Error(`Cannot create child under file: ${input.parentId}`);
      }
      const ext = deps.repository.getNodeMountExtByMountId(parentNode.mountId);
      if (!ext) {
        throw new Error(`Mount config not found: ${parentNode.mountId}`);
      }
      const mount = mountFromExt(ext);
      const provider = deps.registry.get(mount);
      if (!provider.create) {
        throw new Error(
          `Provider "${mount.providerType}" does not support create`,
        );
      }
      const created = await provider.create({
        parentId: parentNode.kind === "mount" ? null : parentNode.sourceRef,
        name: input.name ?? "untitled",
        kind: input.kind ?? "file",
      });
      const now = nowMs();
      const node = toRepositoryNode({
        mountId: mount.mountId,
        item: created,
        now,
      });
      const prev = deps.repository.getNodeById(node.nodeId);
      deps.repository.upsertNodes([
        {
          ...node,
          createdAtMs: prev?.createdAtMs ?? node.createdAtMs,
        },
      ]);
      return deps.repository.getNodeById(node.nodeId) ?? node;
    },

    async rename(input) {
      const node = deps.repository.getNodeById(input.id);
      if (!node) {
        throw new Error(`Node not found: ${input.id}`);
      }
      if (node.kind === "mount") {
        throw new Error(`Mount rename is not supported: ${input.id}`);
      }
      const ext = deps.repository.getNodeMountExtByMountId(node.mountId);
      if (!ext) {
        throw new Error(`Mount config not found: ${node.mountId}`);
      }
      const mount = mountFromExt(ext);
      const provider = deps.registry.get(mount);
      if (!provider.rename) {
        throw new Error(
          `Provider "${mount.providerType}" does not support rename`,
        );
      }
      const renamed = await provider.rename({
        id: node.sourceRef,
        name: input.name,
      });
      const now = nowMs();
      const renamedNode = toRepositoryNode({
        mountId: mount.mountId,
        item: renamed,
        now,
      });
      renamedNode.createdAtMs = node.createdAtMs;
      const upserts: VfsNode[] = [renamedNode];
      if (renamedNode.nodeId !== node.nodeId) {
        upserts.push({
          ...node,
          deletedAtMs: now,
          updatedAtMs: now,
        });
      }
      deps.repository.upsertNodes(upserts);
      return deps.repository.getNodeById(renamedNode.nodeId) ?? renamedNode;
    },

    async delete(input) {
      const node = deps.repository.getNodeById(input.id);
      if (!node) {
        throw new Error(`Node not found: ${input.id}`);
      }
      if (node.kind === "mount") {
        throw new Error(`Use unmount for mount node: ${input.id}`);
      }
      const ext = deps.repository.getNodeMountExtByMountId(node.mountId);
      if (!ext) {
        throw new Error(`Mount config not found: ${node.mountId}`);
      }
      const mount = mountFromExt(ext);
      const provider = deps.registry.get(mount);
      if (!provider.delete) {
        throw new Error(
          `Provider "${mount.providerType}" does not support delete`,
        );
      }
      await provider.delete({
        id: node.sourceRef,
      });
      const now = nowMs();
      const toDelete = deps.repository
        .listNodesByMountId(node.mountId)
        .filter(
          (row) =>
            row.deletedAtMs === null &&
            (row.nodeId === node.nodeId ||
              row.sourceRef === node.sourceRef ||
              row.sourceRef.startsWith(`${node.sourceRef}/`)),
        )
        .map((row) => ({
          ...row,
          deletedAtMs: now,
          updatedAtMs: now,
        }));
      if (toDelete.length > 0) {
        deps.repository.upsertNodes(toDelete);
      }
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

function toRepositoryNode(input: {
  mountId: string;
  item: VfsNode;
  now: number;
}): VfsNode {
  const sourceRef =
    input.item.sourceRef ??
    (input.item as unknown as { id?: string; nodeId?: string }).id ??
    (input.item as unknown as { nodeId?: string }).nodeId ??
    "";
  const normalizedSourceRef = normalizeSourceRef(sourceRef);
  const parentSourceRef =
    input.item.parentId !== undefined && input.item.parentId !== null
      ? normalizeSourceRef(input.item.parentId)
      : parentSourceRefFromSourceRef(normalizedSourceRef);
  return {
    nodeId: createVfsNodeId({
      mountId: input.mountId,
      sourceRef: normalizedSourceRef,
    }),
    mountId: input.mountId,
    parentId: createVfsNodeId({
      mountId: input.mountId,
      sourceRef: parentSourceRef,
    }),
    name: input.item.name,
    kind: input.item.kind,
    size: input.item.size ?? null,
    mtimeMs: input.item.mtimeMs ?? null,
    sourceRef: normalizedSourceRef,
    providerVersion: input.item.providerVersion ?? null,
    deletedAtMs: null,
    createdAtMs: input.now,
    updatedAtMs: input.now,
  };
}

function normalizeSourceRef(sourceRef: string): string {
  return sourceRef
    .split("/")
    .filter((part) => part.length > 0)
    .join("/");
}

function parentSourceRefFromSourceRef(sourceRef: string): string {
  if (!sourceRef) {
    return "";
  }
  const parts = sourceRef.split("/").filter((part) => part.length > 0);
  if (parts.length <= 1) {
    return "";
  }
  return parts.slice(0, parts.length - 1).join("/");
}
