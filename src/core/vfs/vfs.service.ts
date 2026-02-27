import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { decodeVfsCursorToken, encodeVfsLocalCursorToken, encodeVfsRemoteCursorToken } from "./vfs.cursor";
import type { VfsProviderRegistry } from "./vfs.provider.registry";
import type { VfsRepository } from "./vfs.repository.types";
import { resolveParser } from "../parser/parser.registry";
import type { VfsService } from "./vfs.service.types";
import type { VfsMountConfig, VfsNode, WalkChildrenInput, WalkChildrenOutput } from "./vfs.types";

export function createVfsService(deps: {
  repository: VfsRepository;
  registry: VfsProviderRegistry;
  nowMs?: () => number;
}): VfsService {
  const mounts = new Map<string, VfsMountConfig>();
  const nowMs = deps.nowMs ?? (() => Date.now());

  return {
    async mount(config: VfsMountConfig) {
      mounts.set(config.mountId, config);
      deps.repository.upsertMount({
        ...config,
        lastReconcileAtMs: null,
        createdAtMs: nowMs(),
        updatedAtMs: nowMs(),
      });
    },

    async unmount(mountId: string) {
      mounts.delete(mountId);
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

      const adapter = deps.registry.get(mount.providerType);
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
          contentHash: null,
          contentState: "missing",
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

    async readMarkdown(path: string) {
      const resolved = resolveMountByPath(path, mounts);
      if (!resolved) {
        throw new Error(`No mount found for path: ${path}`);
      }
      const { mount } = resolved;
      const node = deps.repository.getNodeByVpath(path);
      if (!node) {
        throw new Error(`Node not found for path: ${path}`);
      }
      if (node.kind !== "file") {
        throw new Error(`Cannot read markdown from non-file node: ${path}`);
      }

      const cached = deps.repository.getMarkdownCache(node.nodeId);
      if (cached && node.contentState === "cached") {
        return {
          node,
          markdown: cached.markdownFull,
        };
      }

      const refreshed = await refreshMarkdown({
        mount,
        node,
        registry: deps.registry,
        repository: deps.repository,
        nowMs,
      });
      return {
        node: refreshed.node,
        markdown: refreshed.markdown,
      };
    },

    async triggerReconcile() {
      return;
    },
  };
}

function resolveMountByPath(path: string, mounts: Map<string, VfsMountConfig>) {
  let best: VfsMountConfig | null = null;
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

async function refreshMarkdown(input: {
  mount: VfsMountConfig;
  node: VfsNode;
  registry: VfsProviderRegistry;
  repository: VfsRepository;
  nowMs: () => number;
}): Promise<{ node: VfsNode; markdown: string }> {
  const { mount, node, registry, repository, nowMs } = input;
  const adapter = registry.get(mount.providerType);

  let markdown: string;
  let generatedBy: "provider_export" | "parser";
  let providerVersion = node.providerVersion;

  if (adapter.capabilities.exportMarkdown && adapter.exportMarkdown) {
    const result = await adapter.exportMarkdown({
      mount,
      sourceRef: node.sourceRef,
    });
    markdown = result.markdown;
    generatedBy = "provider_export";
    providerVersion = result.providerVersion ?? providerVersion;
  } else if (adapter.capabilities.downloadRaw && adapter.downloadRaw) {
    const result = await adapter.downloadRaw({
      mount,
      sourceRef: node.sourceRef,
    });
    const raw = await readFile(result.localPath, "utf8");
    const parser = resolveParser({ ext: extname(result.localPath).toLowerCase() });
    markdown = await parseToMarkdown(parser, raw);
    generatedBy = "parser";
    providerVersion = result.providerVersion ?? providerVersion;
  } else {
    throw new Error(`Provider "${adapter.type}" cannot produce markdown content`);
  }

  const contentHash = `sha256:${createHash("sha256").update(markdown).digest("hex")}`;
  const timestamp = nowMs();

  repository.upsertMarkdownCache({
    nodeId: node.nodeId,
    markdownFull: markdown,
    markdownHash: contentHash,
    generatedBy,
    updatedAtMs: timestamp,
  });
  repository.upsertChunks(chunkMarkdown(node.nodeId, markdown, timestamp));

  const updatedNode: VfsNode = {
    ...node,
    providerVersion,
    contentHash,
    contentState: "cached",
    updatedAtMs: timestamp,
  };
  repository.upsertNodes([updatedNode]);

  return {
    node: updatedNode,
    markdown,
  };
}

async function parseToMarkdown(
  parser: { parseStream: (input: AsyncIterable<string>) => AsyncIterable<{ text: string; skipped?: string }> },
  rawText: string,
): Promise<string> {
  let markdown = "";
  for await (const part of parser.parseStream(singleText(rawText))) {
    if (part.skipped) {
      continue;
    }
    markdown += part.text;
  }
  return markdown;
}

async function* singleText(text: string): AsyncIterable<string> {
  yield text;
}

function chunkMarkdown(nodeId: string, markdown: string, updatedAtMs: number) {
  if (!markdown) {
    return [];
  }
  const chunkSize = 2000;
  const chunks: Array<{
    chunkId: string;
    nodeId: string;
    seq: number;
    markdownChunk: string;
    tokenCount: number | null;
    chunkHash: string;
    updatedAtMs: number;
  }> = [];
  let seq = 0;
  for (let cursor = 0; cursor < markdown.length; cursor += chunkSize) {
    const markdownChunk = markdown.slice(cursor, cursor + chunkSize);
    const chunkHash = createHash("sha256").update(markdownChunk).digest("hex");
    chunks.push({
      chunkId: `${nodeId}:${seq}`,
      nodeId,
      seq,
      markdownChunk,
      tokenCount: null,
      chunkHash,
      updatedAtMs,
    });
    seq += 1;
  }
  return chunks;
}
