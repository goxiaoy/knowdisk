import chokidar from "chokidar";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { blake3 } from "hash-wasm";
import pino, { type Logger } from "pino";
import type { VfsProviderAdapter } from "../../vfs.provider.types";
import type { VfsMount, VfsMountConfig, VfsNode } from "../../vfs.types";

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
      const parentId = input.parentId;
      logger.info(
        {
          mountId: mount.mountId,
          parentId,
        },
        "local listChildren",
      );
      const dirPath = resolveRefPath(config.directory, parentId);
      const entries = await readdir(dirPath, { withFileTypes: true });
      const items: VfsNode[] = [];
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
      return {
        items,
      };
    },
    async createReadStream(input) {
      const config = parseLocalMount(mount);
      const id =
        input.id ??
        (input as unknown as { sourceRef?: string }).sourceRef ??
        "";
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
        throw new Error(
          "createReadStream offset must be a non-negative number",
        );
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
      const id =
        input.id ??
        (input as unknown as { sourceRef?: string }).sourceRef ??
        "";
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
    async getVersion(input) {
      const config = parseLocalMount(mount);
      const id =
        input.id ??
        (input as unknown as { sourceRef?: string }).sourceRef ??
        "";
      const targetPath = resolveRefPath(config.directory, id);
      try {
        const st = await stat(targetPath);
        if (st.isDirectory()) {
          return null;
        }
        return await computeBlake3File(targetPath);
      } catch {
        return null;
      }
    },
    async create(input) {
      const config = parseLocalMount(mount);
      const parentRef = input.parentId ?? null;
      const dirPath = resolveRefPath(config.directory, parentRef);
      const kind = input.kind === "folder" ? "folder" : "file";
      const requestedName = input.name ? sanitizeName(input.name) : "untitled";
      const name = await nextAvailableName(dirPath, requestedName);
      const targetPath = join(dirPath, name);
      if (kind === "folder") {
        await mkdir(targetPath, { recursive: false });
      } else {
        await writeFile(targetPath, "", { flag: "wx" });
      }
      const targetStat = await stat(targetPath);
      const sourceRef = toSourceRef(config.directory, targetPath);
      return toProviderNode({
        mountId: mount.mountId,
        sourceRef,
        parentSourceRef: parentId(sourceRef),
        name,
        kind: targetStat.isDirectory() ? "folder" : "file",
        size: targetStat.isDirectory() ? null : targetStat.size,
        mtimeMs: targetStat.mtimeMs,
        providerVersion: targetStat.isDirectory()
          ? null
          : await computeBlake3File(targetPath),
      });
    },
    async rename(input) {
      const config = parseLocalMount(mount);
      const normalizedId = normalizeSourceRef(input.id);
      if (!normalizedId) {
        throw new Error("rename requires a non-empty id");
      }
      const name = sanitizeName(input.name);
      if (!config.syncName) {
        const sameStat = await stat(
          resolveRefPath(config.directory, normalizedId),
        );
        return toProviderNode({
          mountId: mount.mountId,
          sourceRef: normalizedId,
          parentSourceRef: parentId(normalizedId),
          name,
          kind: sameStat.isDirectory() ? "folder" : "file",
          size: sameStat.isDirectory() ? null : sameStat.size,
          mtimeMs: sameStat.mtimeMs,
          providerVersion: sameStat.isDirectory()
            ? null
            : await computeBlake3File(
                resolveRefPath(config.directory, normalizedId),
              ),
        });
      }
      const oldPath = resolveRefPath(config.directory, normalizedId);
      const parentPath = dirname(oldPath);
      const newPath = join(parentPath, name);
      if (oldPath === newPath) {
        const sameStat = await stat(oldPath);
        return toProviderNode({
          mountId: mount.mountId,
          sourceRef: normalizedId,
          parentSourceRef: parentId(normalizedId),
          name,
          kind: sameStat.isDirectory() ? "folder" : "file",
          size: sameStat.isDirectory() ? null : sameStat.size,
          mtimeMs: sameStat.mtimeMs,
          providerVersion: sameStat.isDirectory()
            ? null
            : await computeBlake3File(oldPath),
        });
      }
      if (await fileExists(newPath)) {
        throw new Error(`target already exists: ${name}`);
      }
      await rename(oldPath, newPath);
      const nextRef = toSourceRef(config.directory, newPath);
      const nextStat = await stat(newPath);
      return toProviderNode({
        mountId: mount.mountId,
        sourceRef: nextRef,
        parentSourceRef: parentId(nextRef),
        name,
        kind: nextStat.isDirectory() ? "folder" : "file",
        size: nextStat.isDirectory() ? null : nextStat.size,
        mtimeMs: nextStat.mtimeMs,
        providerVersion: nextStat.isDirectory()
          ? null
          : await computeBlake3File(newPath),
      });
    },
    async delete(input) {
      const config = parseLocalMount(mount);
      const normalizedId = normalizeSourceRef(input.id);
      if (!normalizedId) {
        throw new Error("delete requires a non-empty id");
      }
      const targetPath = resolveRefPath(config.directory, normalizedId);
      await rm(targetPath, { recursive: true, force: true });
    },
    async watch(input) {
      const config = parseLocalMount(mount as VfsMountConfig);
      logger.info({ mountId: mount.mountId }, "local watch started");
      const watcher = chokidar.watch(config.directory, {
        ignoreInitial: true,
        persistent: true,
      });
      const emit = (type: "add" | "update" | "delete", absPath: string) => {
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
          metadataChanged: true,
          contentUpdated: true,
        } as unknown as Parameters<typeof input.onEvent>[0]);
      };
      watcher.on("add", (path) => emit("add", path));
      watcher.on("change", (path) => emit("update", path));
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
  providerVersion?: string | null;
}): VfsNode {
  return {
    nodeId: input.sourceRef,
    mountId: input.mountId,
    parentId: input.parentSourceRef,
    name: input.name,
    kind: input.kind,
    size: input.size,
    mtimeMs: input.mtimeMs,
    sourceRef: input.sourceRef,
    providerVersion: input.providerVersion ?? null,
    deletedAtMs: null,
    createdAtMs: 0,
    updatedAtMs: 0,
  };
}

async function computeBlake3File(path: string): Promise<string> {
  const content = await readFile(path);
  return blake3(content);
}

function parseLocalMount(mount: Pick<VfsMount, "providerExtra">): {
  directory: string;
  syncName: boolean;
} {
  const dir = mount.providerExtra.directory;
  if (typeof dir !== "string" || dir.trim().length === 0) {
    throw new Error("providerExtra.directory must be a non-empty string");
  }
  const syncNameRaw = mount.providerExtra.syncName;
  const syncName =
    typeof syncNameRaw === "boolean"
      ? syncNameRaw
      : syncNameRaw === undefined
        ? true
        : Boolean(syncNameRaw);
  const resolved = isAbsolute(dir) ? dir : resolve(dir);
  return { directory: resolved, syncName };
}

function normalizeSourceRef(ref: string): string {
  return ref
    .split("/")
    .filter((part) => part.length > 0)
    .join("/");
}

function resolveRefPath(root: string, id: string | null): string {
  const normalized = id ? normalizeSourceRef(id) : "";
  const candidate =
    normalized.length === 0 ? root : resolve(root, ...normalized.split("/"));
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function nextAvailableName(
  dir: string,
  baseName: string,
): Promise<string> {
  let index = 0;
  while (true) {
    const candidate = index === 0 ? baseName : `${baseName}(${index})`;
    if (!(await fileExists(join(dir, candidate)))) {
      return candidate;
    }
    index += 1;
  }
}

function sanitizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("name must be non-empty");
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("name must not contain path separators");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error("name is invalid");
  }
  return trimmed;
}
