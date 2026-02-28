import { randomUUID } from "node:crypto";
import {
  decodeVfsCursorToken,
  encodeVfsLocalCursorToken,
  encodeVfsRemoteCursorToken,
} from "./vfs.cursor";
import { createVfsNodeId } from "./vfs.node-id";
import type { VfsProviderRegistry } from "./vfs.provider.registry";
import type { VfsRepository } from "./vfs.repository.types";
import type { VfsService } from "./vfs.service.types";
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
  nowMs?: () => number;
}): VfsService {
  const nowMs = deps.nowMs ?? (() => Date.now());

  return {
    async mount(config: VfsMountConfig) {
      return this.mountInternal(randomUUID(), config);
    },

    async mountInternal(mountId: string, config: VfsMountConfig) {
      const mount: VfsMount = {
        mountId,
        ...config,
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
        syncMetadata: mount.syncMetadata,
        syncContent: mount.syncContent ?? false,
        metadataTtlSec: mount.metadataTtlSec,
        reconcileIntervalMs: mount.reconcileIntervalMs,
        createdAtMs: now,
        updatedAtMs: now,
      });
      return mount;
    },

    async unmount(mountId: string) {
      void mountId;
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

    async triggerReconcile() {
      return;
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
