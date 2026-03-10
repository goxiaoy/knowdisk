import type { Logger } from "pino";
import type { VfsNode } from "@knowdisk/vfs";
import type { VfsOperationCore } from "@knowdisk/vfs";

export type ParseChunkStatus = "ok" | "skipped" | "error";

export type ParseChunk = {
  chunkIndex: number;
  text: string;
  markdown: string | null;
  title: string | null;
  heading: string | null;
  sectionId: string | null;
  sectionPath: string[];
  charStart: number | null;
  charEnd: number | null;
  tokenEstimate: number | null;
  source: {
    nodeId: string;
    mountId: string;
    sourceRef: string;
    sourceUri: string;
    name: string;
    kind: "file";
    size: number | null;
    mtimeMs: number | null;
    providerVersion: string | null;
  };
  parse: {
    parserId: string;
    parserVersion: string;
    converterId: string;
    converterVersion: string;
  };
  status: ParseChunkStatus;
  error?: {
    code: string;
    message: string;
  };
};

export type ParseSection = {
  sectionId: string;
  heading: string | null;
  depth: number | null;
  sectionPath: string[];
  markdown: string;
  text: string;
  charStart: number;
  charEnd: number;
};

export type ParseDocument = {
  node: VfsNode;
  sourceUri: string;
  providerVersion: string | null;
  title: string | null;
  markdown: string;
  parserId: string;
  parserVersion: string;
  converterId: string;
  converterVersion: string;
  sections: ParseSection[];
};

export type ParseCachePaths = {
  dir: string;
  markdownPath: string;
  manifestPath: string;
  errorPath: string;
};

export type ParseManifest = {
  nodeId: string;
  mountId: string;
  providerVersion: string | null;
  parserId: string;
  parserVersion: string;
  converterId: string;
  converterVersion: string;
  title: string | null;
  createdAt: string;
};

export type CreateParserServiceInput = {
  vfs: VfsOperationCore;
  basePath: string;
  logger: Logger;
  converter?: MarkdownConverter;
};

export type ParserService = {
  parseNode: (input: { nodeId: string }) => AsyncIterable<ParseChunk>;
  materializeNode: (input: { nodeId: string }) => Promise<ParseDocument>;
  getCachePaths: (input: { nodeId: string }) => ParseCachePaths;
};

export type MarkdownConverterResult = {
  title: string | null;
  markdown: string;
};

export type MarkdownConverter = {
  id: string;
  version: string;
  convert: (input: {
    buffer: Buffer;
    node: VfsNode;
  }) => Promise<MarkdownConverterResult>;
};
