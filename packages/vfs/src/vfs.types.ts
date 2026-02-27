export const VFS_TYPES_READY = true;

export type VfsNodeKind = "file" | "folder";

export type VfsMountConfig = {
  mountPath: string;
  providerType: string;
  providerExtra: Record<string, unknown>;
  syncMetadata: boolean;
  syncContent?: boolean;
  metadataTtlSec: number;
  reconcileIntervalMs: number;
};

export type VfsMount = VfsMountConfig & {
  mountId: string;
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
  deletedAtMs: number | null;
  createdAtMs: number;
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
