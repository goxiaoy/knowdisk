import { join } from "node:path";
import type { VfsNode } from "@knowdisk/vfs";
import type { CreateParserServiceInput, ParserService } from "./parser.types";

export function createParserService(
  input: CreateParserServiceInput,
): ParserService {
  const basePath = input.basePath.trim();
  if (!basePath) {
    throw new Error("basePath is required");
  }

  return {
    parseNode(_parseInput) {
      return emptyChunks();
    },
    async materializeNode(parseInput) {
      const node = await getNodeOrThrow(input, parseInput.nodeId);
      const buffer = await readNodeBuffer(input, parseInput.nodeId);
      const markdown = buffer.toString("utf8");

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
      return {
        dir: join(basePath, cacheInput.nodeId),
        markdownPath: join(basePath, cacheInput.nodeId, "document.md"),
        manifestPath: join(basePath, cacheInput.nodeId, "manifest.json"),
        errorPath: join(basePath, cacheInput.nodeId, "error.json"),
      };
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
