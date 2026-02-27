import { randomUUID } from "node:crypto";
import { decodeVfsCursorToken, encodeVfsLocalCursorToken, encodeVfsRemoteCursorToken } from "./vfs.cursor";
import type { VfsProviderRegistry } from "./vfs.provider.registry";
import type { VfsRepository } from "./vfs.repository.types";
import type { VfsService } from "./vfs.service.types";
import type { VfsMount, VfsMountConfig, VfsNode, WalkChildrenInput, WalkChildrenOutput } from "./vfs.types";

export function createVfsService(deps: {
  repository: VfsRepository;
  registry: VfsProviderRegistry;
  nowMs?: () => number;
}): VfsService {
  const mounts = new Map<string, VfsMount>();
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
      mounts.set(mount.mountId, mount);
      deps.repository.upsertMount({
        ...mount,
        lastReconcileAtMs: null,
        createdAtMs: nowMs(),
        updatedAtMs: nowMs(),
      });
      return mount;
    },

    async unmount(mountId: string) {
      mounts.delete(mountId);
    },

    async listChildren(input) {
      const adapter = deps.registry.get(input.mount);
      return adapter.listChildren(input);
    },

    async createReadStream(input) {
      const adapter = deps.registry.get(input.mount);
      if (!adapter.createReadStream) {
        throw new Error(`Provider "${adapter.type}" does not support createReadStream`);
      }
      return adapter.createReadStream(input);
    },

    async walkChildren(input: WalkChildrenInput): Promise<WalkChildrenOutput> {
      const resolved = resolveMountByPath(input.path, mounts);
      if (!resolved) {
        throw new Error(`No mount found for path: ${input.path}`);
      }

      const { mount, relativePath } = resolved;
      const parentNode = relativePath ? deps.repository.getNodeByVpath(input.path) : null;

      if (mount.syncMetadata) {
        const localCursor = decodeLocalCursor(input.cursor?.token);
        const page = deps.repository.listChildrenPageLocal({
          mountId: mount.mountId,
          parentId: parentNode?.nodeId ?? null,
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

      const adapter = deps.registry.get(mount);
      const parentSourceRef = parentNode?.sourceRef ?? null;
      const providerCursor = decodeRemoteCursor(input.cursor?.token);
      const cacheKey = `${mount.mountId}::${parentSourceRef ?? "__root__"}::${providerCursor ?? ""}::${input.limit}`;
      const cached = deps.repository.getPageCacheIfFresh(cacheKey, nowMs());

      if (cached) {
        return {
          items: JSON.parse(cached.itemsJson) as VfsNode[],
          nextCursor: cached.nextCursor
            ? {
                mode: "remote",
                token: encodeVfsRemoteCursorToken({ providerCursor: cached.nextCursor }),
              }
            : undefined,
          source: "remote",
        };
      }

      const listed = await adapter.listChildren({
        mount,
        parentSourceRef,
        limit: input.limit,
        cursor: providerCursor ?? undefined,
      });

      const items = listed.items.map((item) => {
        const childPath = buildChildPath(relativePath ? input.path : mount.mountPath, item.name);
        return {
          nodeId: `${mount.mountId}:${item.sourceRef}:${randomUUID()}`,
          mountId: mount.mountId,
          parentId: parentNode?.nodeId ?? null,
          name: item.name,
          vpath: childPath,
          kind: item.kind,
          title: item.title ?? item.name,
          size: item.size ?? null,
          mtimeMs: item.mtimeMs ?? null,
          sourceRef: item.sourceRef,
          providerVersion: item.providerVersion ?? null,
          deletedAtMs: null,
          createdAtMs: nowMs(),
          updatedAtMs: nowMs(),
        } satisfies VfsNode;
      });

      deps.repository.upsertNodes(items);
      deps.repository.upsertPageCache({
        cacheKey,
        itemsJson: JSON.stringify(items),
        nextCursor: listed.nextCursor ?? null,
        expiresAtMs: nowMs() + mount.metadataTtlSec * 1000,
      });

      return {
        items,
        nextCursor: listed.nextCursor
          ? {
              mode: "remote",
              token: encodeVfsRemoteCursorToken({ providerCursor: listed.nextCursor }),
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

function resolveMountByPath(path: string, mounts: Map<string, VfsMount>) {
  let best: VfsMount | null = null;
  for (const mount of mounts.values()) {
    if (path === mount.mountPath || path.startsWith(`${mount.mountPath}/`)) {
      if (!best || mount.mountPath.length > best.mountPath.length) {
        best = mount;
      }
    }
  }
  if (!best) {
    return null;
  }
  const relative = path.slice(best.mountPath.length).replace(/^\//, "");
  return {
    mount: best,
    relativePath: relative.length > 0 ? relative : null,
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

function buildChildPath(parentPath: string, name: string): string {
  if (parentPath.endsWith("/")) {
    return `${parentPath}${name}`;
  }
  return `${parentPath}/${name}`;
}
