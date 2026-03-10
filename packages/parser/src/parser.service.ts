import { join } from "node:path";
import type { VfsNode } from "@knowdisk/vfs";
import { readCachedMarkdown, writeCachedMarkdown } from "./parser.cache";
import type {
  CreateParserServiceInput,
  ParseCachePaths,
  ParseManifest,
  ParserService,
} from "./parser.types";

export function createParserService(
  input: CreateParserServiceInput,
): ParserService {
  const basePath = input.basePath.trim();
  const mountIdsByNodeId = new Map<string, string>();
  if (!basePath) {
    throw new Error("basePath is required");
  }

  return {
    parseNode(_parseInput) {
      return emptyChunks();
    },
    async materializeNode(parseInput) {
      const node = await getNodeOrThrow(input, parseInput.nodeId);
      mountIdsByNodeId.set(node.nodeId, node.mountId);
      const cachePaths = getCachePaths(basePath, parseInput.nodeId, node.mountId);
      const cached = await readCachedMarkdown(cachePaths);
      const markdown =
        cached && cached.manifest.providerVersion === node.providerVersion && node.providerVersion !== null
          ? cached.markdown
          : await rebuildMarkdown(input, cachePaths, node);

      return {
        node,
        sourceUri: toSourceUri(node),
        providerVersion: node.providerVersion,
        title: null,
        markdown,
        parserId: "parser",
        parserVersion: "0.0.0",
        converterId: "buffer",
        converterVersion: "0.0.0",
        sections: [],
      };
    },
    getCachePaths(cacheInput) {
      return getCachePaths(
        basePath,
        cacheInput.nodeId,
        mountIdsByNodeId.get(cacheInput.nodeId),
      );
    },
  };
}

async function* emptyChunks() {
  return;
}

async function getNodeOrThrow(
  input: CreateParserServiceInput,
  nodeId: string,
): Promise<VfsNode> {
  const node = await input.vfs.getMetadata({ id: nodeId });
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }
  if (node.kind !== "file") {
    throw new Error(`Node is not a file: ${nodeId}`);
  }
  return node;
}

async function readNodeBuffer(
  input: CreateParserServiceInput,
  nodeId: string,
): Promise<Buffer> {
  if (!input.vfs.createReadStream) {
    throw new Error(`VFS does not support createReadStream: ${nodeId}`);
  }
  const stream = await input.vfs.createReadStream({ id: nodeId });
  const arrayBuffer = await new Response(stream).arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function toSourceUri(node: VfsNode): string {
  return `vfs://${node.mountId}/${node.nodeId}/${encodeURIComponent(node.name)}`;
}

function getCachePaths(
  basePath: string,
  nodeId: string,
  mountId?: string,
): ParseCachePaths {
  const dir = mountId ? join(basePath, mountId, nodeId) : join(basePath, nodeId);
  return {
    dir,
    markdownPath: join(dir, "document.md"),
    manifestPath: join(dir, "manifest.json"),
    errorPath: join(dir, "error.json"),
  };
}

async function rebuildMarkdown(
  input: CreateParserServiceInput,
  cachePaths: ParseCachePaths,
  node: VfsNode,
): Promise<string> {
  const buffer = await readNodeBuffer(input, node.nodeId);
  const markdown = buffer.toString("utf8");
  await writeCachedMarkdown(cachePaths, {
    markdown,
    manifest: createManifest(node),
  });
  return markdown;
}

function createManifest(node: VfsNode): ParseManifest {
  return {
    nodeId: node.nodeId,
    mountId: node.mountId,
    providerVersion: node.providerVersion,
    parserId: "parser",
    parserVersion: "0.0.0",
    converterId: "buffer",
    converterVersion: "0.0.0",
    title: null,
    createdAt: new Date().toISOString(),
  };
}
