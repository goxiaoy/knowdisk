export const VFS_TYPES_READY = true;

export type VfsNodeKind = "file" | "folder";
export type SyncMode = "eager" | "lazy";
export type ContentState = "missing" | "cached" | "stale";

export type VfsMountConfig = {
  mountId: string;
  mountPath: string;
  providerType: string;
  syncMetadata: boolean;
  syncContent: SyncMode;
  metadataTtlSec: number;
  reconcileIntervalMs: number;
};

export type VfsNode = {
  nodeId: string;
  mountId: string;
  parentId: string | null;
  name: string;
  vpath: string;
  kind: VfsNodeKind;
  title: string;
  size: number | null;
  mtimeMs: number | null;
  sourceRef: string;
  providerVersion: string | null;
  contentHash: string | null;
  contentState: ContentState;
  deletedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type VfsChunk = {
  chunkId: string;
  nodeId: string;
  seq: number;
  markdownChunk: string;
  tokenCount: number | null;
  chunkHash: string;
  updatedAtMs: number;
};

export type VfsMarkdownCache = {
  nodeId: string;
  markdownFull: string;
  markdownHash: string;
  generatedBy: "provider_export" | "parser";
  updatedAtMs: number;
};

export type VfsCursor = {
  mode: "local" | "remote";
  token: string;
};

export type WalkChildrenInput = {
  path: string;
  limit: number;
  cursor?: VfsCursor;
};

export type WalkChildrenOutput = {
  items: VfsNode[];
  nextCursor?: VfsCursor;
  source: "local" | "remote";
};
