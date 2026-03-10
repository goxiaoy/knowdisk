import { join } from "node:path";
import type { VfsNode } from "@knowdisk/vfs";
import { defaultMarkdownConverter } from "./converter";
import {
  readCachedMarkdown,
  writeCachedMarkdown,
  writeParseError,
} from "./parser.cache";
import { splitMarkdownIntoSections } from "./section-splitter";
import { defaultTextSplitter } from "./text-splitter";
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
  const converter = input.converter ?? defaultMarkdownConverter;
  const textSplitter = input.textSplitter ?? defaultTextSplitter;
  const mountIdsByNodeId = new Map<string, string>();
  if (!basePath) {
    throw new Error("basePath is required");
  }

  return {
    async *parseNode(parseInput) {
      const node = await getNodeOrThrow(input, parseInput.nodeId);
      try {
        const document = await this.materializeNode(parseInput);
        let chunkIndex = 0;

        for (const section of document.sections) {
          const parts = await textSplitter.splitText({
            text: section.text,
            sectionPath: section.sectionPath,
          });
          let sectionCursor = section.charStart;

          for (const part of parts) {
            const text = part.trim();
            if (!text) {
              continue;
            }
            const relativeStart = section.markdown.indexOf(text);
            const charStart =
              relativeStart >= 0
                ? section.charStart + relativeStart
                : sectionCursor;
            const charEnd = charStart + text.length;
            sectionCursor = charEnd;

            yield {
              chunkIndex,
              text,
              markdown: text,
              title: document.title,
              heading: section.heading,
              sectionId: section.sectionId,
              sectionPath: section.sectionPath,
              charStart,
              charEnd,
              tokenEstimate: estimateTokens(text),
              source: {
                nodeId: document.node.nodeId,
                mountId: document.node.mountId,
                sourceRef: document.node.sourceRef,
                sourceUri: document.sourceUri,
                name: document.node.name,
                kind: "file",
                size: document.node.size,
                mtimeMs: document.node.mtimeMs,
                providerVersion: document.node.providerVersion,
              },
              parse: {
                parserId: document.parserId,
                parserVersion: document.parserVersion,
                converterId: document.converterId,
                converterVersion: document.converterVersion,
              },
              status: "ok" as const,
            };
            chunkIndex += 1;
          }
        }

        if (chunkIndex === 0) {
          yield createSkippedChunk(node, "EMPTY_MARKDOWN", "markdown is empty");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        input.logger.error({ nodeId: node.nodeId, error: message }, "parser failed");
        yield createErrorChunk(node, message);
      }
    },
    async materializeNode(parseInput) {
      const node = await getNodeOrThrow(input, parseInput.nodeId);
      mountIdsByNodeId.set(node.nodeId, node.mountId);
      const cachePaths = getCachePaths(basePath, parseInput.nodeId, node.mountId);
      const cached = await readCachedMarkdown(cachePaths);
      const cacheHit =
        cached &&
        cached.manifest.providerVersion === node.providerVersion &&
        node.providerVersion !== null;
      const rebuilt =
        cacheHit ? null : await rebuildMarkdown(input, cachePaths, node, converter);
      const markdown =
        cacheHit
          ? cached.markdown
          : rebuilt?.markdown ?? "";
      const title =
        cached && cached.manifest.providerVersion === node.providerVersion && node.providerVersion !== null
          ? cached.manifest.title
          : rebuilt?.title ?? null;

      return {
        node,
        sourceUri: toSourceUri(node),
        providerVersion: node.providerVersion,
        title,
        markdown,
        parserId: "parser",
        parserVersion: "0.0.0",
        converterId: converter.id,
        converterVersion: converter.version,
        sections: splitMarkdownIntoSections(markdown),
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
  converter: CreateParserServiceInput["converter"] extends infer T ? NonNullable<T> : never,
): Promise<{ markdown: string; title: string | null }> {
  const buffer = await readNodeBuffer(input, node.nodeId);
  let result;
  try {
    result = await converter.convert({ buffer, node });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeParseError(cachePaths, {
      code: "PARSE_ERROR",
      message,
      createdAt: new Date().toISOString(),
    });
    throw error;
  }
  await writeCachedMarkdown(cachePaths, {
    markdown: result.markdown,
    manifest: createManifest(node, converter, result.title),
  });
  return result;
}

function createManifest(
  node: VfsNode,
  converter: { id: string; version: string },
  title: string | null,
): ParseManifest {
  return {
    nodeId: node.nodeId,
    mountId: node.mountId,
    providerVersion: node.providerVersion,
    parserId: "parser",
    parserVersion: "0.0.0",
    converterId: converter.id,
    converterVersion: converter.version,
    title,
    createdAt: new Date().toISOString(),
  };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function createSkippedChunk(node: VfsNode, code: string, message: string) {
  return {
    chunkIndex: 0,
    text: "",
    markdown: null,
    title: null,
    heading: null,
    sectionId: null,
    sectionPath: [],
    charStart: null,
    charEnd: null,
    tokenEstimate: null,
    source: {
      nodeId: node.nodeId,
      mountId: node.mountId,
      sourceRef: node.sourceRef,
      sourceUri: toSourceUri(node),
      name: node.name,
      kind: "file" as const,
      size: node.size,
      mtimeMs: node.mtimeMs,
      providerVersion: node.providerVersion,
    },
    parse: {
      parserId: "parser",
      parserVersion: "0.0.0",
      converterId: "unknown",
      converterVersion: "0.0.0",
    },
    status: "skipped" as const,
    error: { code, message },
  };
}

function createErrorChunk(node: VfsNode, message: string) {
  return {
    ...createSkippedChunk(node, "PARSE_ERROR", message),
    status: "error" as const,
    error: {
      code: "PARSE_ERROR",
      message,
    },
  };
}
