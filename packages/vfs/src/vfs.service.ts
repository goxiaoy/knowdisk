import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { join } from "node:path";
import {
  decodeVfsCursorToken,
  encodeVfsLocalCursorToken,
} from "./vfs.cursor";
import {
  createVfsContentNodeEventsProcessor,
  createVfsMetadataNodeEventsProcessor,
} from "./vfs.node-event-processor";
import { createVfsNodeId } from "./vfs.node-id";
import type { VfsMountRepository } from "./vfs.mount.repository.types";
import type { VfsProviderRegistry } from "./vfs.provider.registry";
import type { VfsNodeRepository } from "./vfs.repository.types";
import {
  createVfsSyncer,
  type VfsSyncer,
  type VfsSyncerEvent,
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
  repository: VfsNodeRepository;
  mountRepository: VfsMountRepository;
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
  const syncerEventListeners = new Set<(event: { mountId: string; event: VfsSyncerEvent }) => void>();
  const syncers = new Map<string, { mount: VfsMount; syncer: VfsSyncer; stopSub: () => void }>();
  let nextHookRegistrationId = 1;

  const mountFromExt = (ext: ReturnType<VfsMountRepository["getNodeMountExtByMountId"]>): VfsMount => {
    if (!ext) {
      throw new Error("mount config not found");
    }
    return {
      mountId: ext.mountId,
      providerType: ext.providerType,
      providerExtra: ext.providerExtra,
      autoSync: ext.autoSync !== false,
      syncContent: ext.syncContent,
      metadataTtlSec: ext.metadataTtlSec,
      reconcileIntervalMs: ext.reconcileIntervalMs,
    };
  };

  const isAutoSyncEnabled = (mount: VfsMount): boolean => mount.autoSync !== false;

  const emitSyncerEvent = (mountId: string, event: VfsSyncerEvent): void => {
    for (const listener of syncerEventListeners) {
      listener({ mountId, event });
    }
  };

  const resolveMountForNodeEvent = (mountId: string): VfsMount | null => {
    const active = syncers.get(mountId);
    if (active) {
      return active.mount;
    }
    const ext = deps.mountRepository.getNodeMountExtByMountId(mountId);
    if (ext) {
      return mountFromExt(ext);
    }
    return null;
  };

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

  const metadataNodeEventsProcessor =
    deps.contentRootParent === undefined
      ? null
      : createVfsMetadataNodeEventsProcessor({
          repository: deps.repository,
          contentRootParent: deps.contentRootParent,
          resolveMount: resolveMountForNodeEvent,
          resolveProvider(mount) {
            return deps.registry.get(mount);
          },
          hooks: hooksRunner,
          nowMs,
          logger: deps.logger,
          emitSyncerEvent,
        });
  const contentNodeEventsProcessor =
    deps.contentRootParent === undefined
      ? null
      : createVfsContentNodeEventsProcessor({
          repository: deps.repository,
          contentRootParent: deps.contentRootParent,
          resolveMount: resolveMountForNodeEvent,
          resolveProvider(mount) {
            return deps.registry.get(mount);
          },
          hooks: hooksRunner,
          nowMs,
          logger: deps.logger,
          emitSyncerEvent,
        });

  const ensureNodeEventsProcessorsStarted = (): void => {
    metadataNodeEventsProcessor?.start();
    contentNodeEventsProcessor?.start();
  };

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
      logger: deps.logger,
      nowMs,
    });
    const stopSub = syncer.subscribe((event) => {
      emitSyncerEvent(mount.mountId, event);
    });
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
    ensureNodeEventsProcessorsStarted();
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
      const ext = deps.mountRepository.getNodeMountExtByMountId(mountId);
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

  const createMountNode = async (input: {
    mountId: string;
    parentNodeId: string | null;
    config: VfsMountConfig;
  }): Promise<VfsMount> => {
    const mountName = input.config.name?.trim() || input.mountId;
    const mount: VfsMount = {
      mountId: input.mountId,
      ...input.config,
      autoSync: input.config.autoSync !== false,
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
        mountNodeId: mount.mountId,
        parentId: input.parentNodeId,
        name: mountName,
        kind: "mount",
        type: "mount",
        origin: "managed",
        size: null,
        mtimeMs: null,
        sourceRef: "",
        providerVersion: null,
        deletedAtMs: null,
        createdAtMs: now,
        updatedAtMs: now,
      },
    ]);
    deps.mountRepository.upsertNodeMountExt({
      nodeId: mountNodeId,
      mountId: mount.mountId,
      providerType: mount.providerType,
      providerExtra: mount.providerExtra,
      autoSync: mount.autoSync !== false,
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
  };

  const listAllChildren = (parentId: string): VfsNode[] => {
    const items: VfsNode[] = [];
    let cursor: { lastName: string; lastNodeId: string } | undefined;
    while (true) {
      const page = deps.repository.listChildrenPageLocal({
        parentId,
        limit: 500,
        cursor,
      });
      items.push(...page.items);
      if (!page.nextCursor) {
        break;
      }
      cursor = page.nextCursor;
    }
    return items;
  };

  const collectSubtree = (rootNodeId: string): VfsNode[] => {
    const collected: VfsNode[] = [];
    const queue = [rootNodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentNode = deps.repository.getNodeById(current);
      if (!currentNode || currentNode.deletedAtMs !== null) {
        continue;
      }
      collected.push(currentNode);
      for (const child of listAllChildren(currentNode.nodeId)) {
        queue.push(child.nodeId);
      }
    }
    return collected;
  };

  return {
    subscribeNodeChanges(listener) {
      return deps.repository.subscribeNodeChanges(listener);
    },
    getQueueProgressByMountId(mountId) {
      return deps.repository.getQueueProgressByMountId(mountId);
    },
    subscribeSyncerEvents(listener) {
      syncerEventListeners.add(listener);
      return () => {
        syncerEventListeners.delete(listener);
      };
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
      ensureNodeEventsProcessorsStarted();
      const mounts = deps.mountRepository.listNodeMountExts().map((ext) => mountFromExt(ext));
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
      metadataNodeEventsProcessor?.close();
      contentNodeEventsProcessor?.close();
      started = false;
    },

    async createNode(input) {
      if (input.type === "mount") {
        return createMountNode({
          mountId: input.mountId ?? randomUUID(),
          parentNodeId: input.parentId,
          config: {
            ...input.ext,
            name: input.name ?? input.ext.name,
          },
        });
      }
      const parentNode = input.parentId ? deps.repository.getNodeById(input.parentId) : null;
      if (input.parentId && !parentNode) {
        throw new Error(`Parent node not found: ${input.parentId}`);
      }
      if (parentNode?.kind === "file") {
        throw new Error(`Cannot create child under file: ${input.parentId}`);
      }
      if (parentNode?.kind === "mount") {
        throw new Error(`Cannot create managed child under mount: ${input.parentId}`);
      }
      const now = nowMs();
      const nodeId = randomUUID();
      const mountId = parentNode?.mountId ?? nodeId;
      const mountNodeId = parentNode?.mountNodeId ?? nodeId;
      const node: VfsNode = {
        nodeId,
        mountId,
        mountNodeId,
        parentId: input.parentId,
        name: input.name.trim(),
        kind: "folder",
        type: "folder",
        origin: "managed",
        size: null,
        mtimeMs: null,
        sourceRef: `managed:${nodeId}`,
        providerVersion: null,
        deletedAtMs: null,
        createdAtMs: now,
        updatedAtMs: now,
      };
      deps.repository.upsertNodes([node]);
      return deps.repository.getNodeById(nodeId) ?? node;
    },

    async getNode(input) {
      return this.getMetadata({ id: input.id });
    },

    async renameNode(input) {
      if (!this.rename) {
        throw new Error("rename is not supported");
      }
      return this.rename(input);
    },

    async deleteNode(input) {
      if (!this.delete) {
        throw new Error("delete is not supported");
      }
      await this.delete(input);
    },

    async listNodeChildren(input) {
      return this.walkChildren(input);
    },

    async mount(config: VfsMountConfig) {
      return createMountNode({
        mountId: randomUUID(),
        parentNodeId: null,
        config,
      });
    },

    async mountInternal(mountId: string, config: VfsMountConfig) {
      return createMountNode({
        mountId,
        parentNodeId: null,
        config,
      });
    },

    async unmount(mountId: string) {
      ensureNodeEventsProcessorsStarted();
      clearReconcileTimer(mountId);
      await stopSyncer(mountId);
      const now = nowMs();
      const rows = deps.repository
        .listNodesByMountNodeId(mountId)
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
          }))
        );
      }
      deps.mountRepository.deleteNodeMountExtByMountId(mountId);
    },

    async listChildren(input) {
      if (input.parentId === null) {
        throw new Error("listChildren requires parentId; use walkChildren for root listing");
      }
      const parentNode = deps.repository.getNodeById(input.parentId);
      if (!parentNode) {
        throw new Error(`Parent node not found: ${input.parentId}`);
      }
      const ext = deps.mountRepository.getNodeMountExtByMountId(parentNode.mountId);
      if (!ext) {
        throw new Error(`Mount config not found: ${parentNode.mountId}`);
      }
      const mount: VfsMount = {
        mountId: ext.mountId,
        providerType: ext.providerType,
        providerExtra: ext.providerExtra,
        autoSync: ext.autoSync !== false,
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
      const ext = deps.mountRepository.getNodeMountExtByMountId(node.mountId);
      if (!ext) {
        throw new Error(`Mount config not found: ${node.mountId}`);
      }
      const mount = mountFromExt(ext);
      if (mount.syncContent) {
        if (!deps.contentRootParent) {
          throw new Error("contentRootParent is required for syncContent reads");
        }
        const localPath = join(deps.contentRootParent, mount.mountId, ...node.sourceRef.split("/"));
        const file = Bun.file(localPath);
        if (input.offset !== undefined || input.length !== undefined) {
          const start = input.offset ?? 0;
          const end = input.length === undefined ? undefined : start + input.length;
          return file.slice(start, end).stream();
        }
        return file.stream();
      }
      const provider = deps.registry.get(mount);
      if (!provider.createReadStream) {
        throw new Error(`Provider "${mount.providerType}" does not support createReadStream`);
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
      const ext = deps.mountRepository.getNodeMountExtByMountId(parentNode.mountId);
      if (!ext) {
        throw new Error(`Mount config not found: ${parentNode.mountId}`);
      }
      const mount = mountFromExt(ext);
      const provider = deps.registry.get(mount);
      if (!provider.create) {
        throw new Error(`Provider "${mount.providerType}" does not support create`);
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
      const nextName = input.name.trim();
      if (!nextName) {
        throw new Error("name is required");
      }
      if (node.origin === "managed" || node.kind === "mount") {
        const now = nowMs();
        deps.repository.upsertNodes([
          {
            ...node,
            name: nextName,
            updatedAtMs: now,
          },
        ]);
        return deps.repository.getNodeById(node.nodeId) ?? { ...node, name: nextName, updatedAtMs: now };
      }
      const ext = deps.mountRepository.getNodeMountExtByMountId(node.mountId);
      if (!ext) {
        throw new Error(`Mount config not found: ${node.mountId}`);
      }
      const mount = mountFromExt(ext);
      const provider = deps.registry.get(mount);
      if (!provider.rename) {
        throw new Error(`Provider "${mount.providerType}" does not support rename`);
      }
      const renamed = await provider.rename({
        id: node.sourceRef,
        name: nextName,
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
      if (node.origin === "managed") {
        const now = nowMs();
        const subtree = collectSubtree(node.nodeId);
        const mountIds = new Set(subtree.filter((row) => row.kind === "mount").map((row) => row.mountId));
        for (const mountId of mountIds) {
          clearReconcileTimer(mountId);
          await stopSyncer(mountId);
          deps.mountRepository.deleteNodeMountExtByMountId(mountId);
        }
        if (subtree.length > 0) {
          deps.repository.upsertNodes(
            subtree.map((row) => ({
              ...row,
              deletedAtMs: now,
              updatedAtMs: now,
            }))
          );
        }
        return;
      }
      if (node.kind === "mount") {
        await this.unmount(node.mountId);
        return;
      }
      const ext = deps.mountRepository.getNodeMountExtByMountId(node.mountId);
      if (!ext) {
        throw new Error(`Mount config not found: ${node.mountId}`);
      }
      const mount = mountFromExt(ext);
      const provider = deps.registry.get(mount);
      if (!provider.delete) {
        throw new Error(`Provider "${mount.providerType}" does not support delete`);
      }
      await provider.delete({
        id: node.sourceRef,
      });
      const now = nowMs();
      const toDelete = deps.repository
        .listNodesByMountNodeId(node.mountNodeId)
        .filter(
          (row) =>
            row.deletedAtMs === null &&
            (row.nodeId === node.nodeId ||
              row.sourceRef === node.sourceRef ||
              row.sourceRef.startsWith(`${node.sourceRef}/`))
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
      return walkLocalChildren({
        repository: deps.repository,
        parentNodeId: parentNode.nodeId,
        limit: input.limit,
        cursorToken: input.cursor?.token,
      });
    },

    async triggerReconcile(mountId: string) {
      await runReconcile(mountId);
    },
  };
}

function walkLocalChildren(input: {
  repository: VfsNodeRepository;
  parentNodeId?: string | null;
  limit: number;
  cursorToken?: string;
}): WalkChildrenOutput {
  const localCursor = decodeLocalCursor(input.cursorToken);
  const page = input.repository.listChildrenPageLocal({
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

function toRepositoryNode(input: { mountId: string; item: VfsNode; now: number }): VfsNode {
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
    mountNodeId: input.mountId,
    parentId: createVfsNodeId({
      mountId: input.mountId,
      sourceRef: parentSourceRef,
    }),
    name: input.item.name,
    kind: input.item.kind,
    type: input.item.kind,
    origin: normalizedSourceRef === "" ? "managed" : "provider",
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
