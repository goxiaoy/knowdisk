import chokidar from "chokidar";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import pino, { type Logger } from "pino";
import type { VfsProviderAdapter } from "../../vfs.provider.types";
import type { ListChildrenItem } from "../../vfs.service.types";
import type { VfsMount, VfsMountConfig } from "../../vfs.types";

type CreateLocalVfsProviderDeps = {
  logger?: Logger;
};

export function createLocalVfsProvider(
  mount: VfsMount,
  deps?: CreateLocalVfsProviderDeps,
): VfsProviderAdapter {
  const logger =
    deps?.logger ??
    pino({
      name: "knowdisk.vfs.provider.local",
    });
  return {
    type: "local",
    capabilities: { watch: true },
    async listChildren(input) {
      const config = parseLocalMount(mount);
      const parentId =
        input.parentId ??
        ((input as unknown as { parentSourceRef?: string | null }).parentSourceRef ?? null);
      logger.info(
        {
          mountId: mount.mountId,
          parentId,
          limit: input.limit,
          cursor: input.cursor,
        },
        "local listChildren",
      );
      const dirPath = resolveRefPath(config.directory, parentId);
      const entries = await readdir(dirPath, { withFileTypes: true });
      const items: ListChildrenItem[] = [];
      for (const entry of entries) {
        const absPath = join(dirPath, entry.name);
        const entryStat = await stat(absPath);
        const sourceRef = toSourceRef(config.directory, absPath);
        items.push(
          toProviderNode({
            mountId: mount.mountId,
            sourceRef,
            parentSourceRef: parentId,
            name: entry.name,
            kind: entry.isDirectory() ? "folder" : "file",
            size: entry.isDirectory() ? null : entryStat.size,
            mtimeMs: entryStat.mtimeMs,
          }),
        );
      }
      items.sort((a, b) => {
        if (a.kind !== b.kind) {
          return a.kind === "file" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      const offset = parseCursorOffset(input.cursor);
      const page = items.slice(offset, offset + input.limit);
      const nextOffset = offset + input.limit;
      return {
        items: page,
        nextCursor: nextOffset < items.length ? String(nextOffset) : undefined,
      };
    },
    async createReadStream(input) {
      const config = parseLocalMount(mount);
      const id = input.id ?? ((input as unknown as { sourceRef?: string }).sourceRef ?? "");
      logger.info(
        {
          mountId: mount.mountId,
          id,
          offset: input.offset,
          length: input.length,
        },
        "local createReadStream",
      );
      const filePath = resolveRefPath(config.directory, id);
      const hasOffset = typeof input.offset === "number";
      const hasLength = typeof input.length === "number";
      if (hasOffset && (!Number.isFinite(input.offset) || input.offset! < 0)) {
        throw new Error("createReadStream offset must be a non-negative number");
      }
      if (hasLength && (!Number.isFinite(input.length) || input.length! <= 0)) {
        throw new Error("createReadStream length must be a positive number");
      }
      const start = hasOffset ? Math.floor(input.offset!) : undefined;
      const end =
        hasLength && start !== undefined
          ? start + Math.floor(input.length!) - 1
          : undefined;
      return Readable.toWeb(
        createReadStream(filePath, { start, end }),
      ) as unknown as ReadableStream<Uint8Array>;
    },
    async getMetadata(input) {
      const config = parseLocalMount(mount);
      const id = input.id ?? ((input as unknown as { sourceRef?: string }).sourceRef ?? "");
      logger.info(
        {
          mountId: mount.mountId,
          id,
        },
        "local getMetadata",
      );
      const targetPath = resolveRefPath(config.directory, id);
      try {
        const targetStat = await stat(targetPath);
        const normalized = normalizeSourceRef(id);
        const parent = parentId(normalized);
        return toProviderNode({
          mountId: mount.mountId,
          sourceRef: normalized,
          parentSourceRef: parent,
          name: normalized.split("/").pop() ?? normalized,
          kind: targetStat.isDirectory() ? "folder" : "file",
          size: targetStat.isDirectory() ? null : targetStat.size,
          mtimeMs: targetStat.mtimeMs,
        });
      } catch {
        return null;
      }
    },
    async watch(input) {
      const config = parseLocalMount(mount as VfsMountConfig);
      logger.info({ mountId: mount.mountId }, "local watch started");
      const watcher = chokidar.watch(config.directory, {
        ignoreInitial: true,
        persistent: true,
      });
      const emit = (
        type: "add" | "update_metadata" | "update_content" | "delete",
        absPath: string,
      ) => {
        const id = toSourceRef(config.directory, absPath);
        logger.info(
          {
            mountId: mount.mountId,
            type,
            id,
          },
          "local watch event",
        );
        input.onEvent({
          type,
          id,
          parentId: parentId(id),
          sourceRef: id,
          parentSourceRef: parentId(id),
        } as unknown as Parameters<typeof input.onEvent>[0]);
      };
      watcher.on("add", (path) => emit("add", path));
      watcher.on("change", (path) => emit("update_content", path));
      watcher.on("addDir", (path) => emit("add", path));
      watcher.on("unlink", (path) => emit("delete", path));
      watcher.on("unlinkDir", (path) => emit("delete", path));
      await new Promise<void>((resolve) => {
        watcher.on("ready", () => resolve());
      });
      return {
        close: async () => {
          await watcher.close();
          logger.info({ mountId: mount.mountId }, "local watch stopped");
        },
      };
    },
  };
}

function toProviderNode(input: {
  mountId: string;
  sourceRef: string;
  parentSourceRef: string | null;
  name: string;
  kind: "file" | "folder";
  size: number | null;
  mtimeMs: number;
}): ListChildrenItem {
  return {
    nodeId: input.sourceRef,
    mountId: input.mountId,
    parentId: input.parentSourceRef,
    name: input.name,
    kind: input.kind,
    title: input.name,
    size: input.size,
    mtimeMs: input.mtimeMs,
    sourceRef: input.sourceRef,
    providerVersion: null,
    deletedAtMs: null,
    createdAtMs: 0,
    updatedAtMs: 0,
  };
}

function parseLocalMount(mount: Pick<VfsMount, "providerExtra">): { directory: string } {
  const dir = mount.providerExtra.directory;
  if (typeof dir !== "string" || dir.trim().length === 0) {
    throw new Error("providerExtra.directory must be a non-empty string");
  }
  const resolved = isAbsolute(dir) ? dir : resolve(dir);
  return { directory: resolved };
}

function parseCursorOffset(cursor?: string): number {
  if (!cursor) {
    return 0;
  }
  const offset = Number(cursor);
  if (!Number.isFinite(offset) || offset < 0) {
    return 0;
  }
  return Math.floor(offset);
}

function normalizeSourceRef(ref: string): string {
  return ref
    .split("/")
    .filter((part) => part.length > 0)
    .join("/");
}

function resolveRefPath(root: string, id: string | null): string {
  const normalized = id ? normalizeSourceRef(id) : "";
  const candidate = normalized.length === 0 ? root : resolve(root, ...normalized.split("/"));
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
    throw new Error(`id escapes provider root: "${id ?? ""}"`);
  }
  return candidate;
}

function toSourceRef(root: string, absPath: string): string {
  const rel = relative(root, absPath);
  if (!rel || rel === ".") {
    return "";
  }
  return rel.split(sep).join("/");
}

function parentId(id: string): string | null {
  const parent = dirname(id);
  if (!parent || parent === "." || parent === "/") {
    return null;
  }
  return parent.split(sep).join("/");
}
