import type { VfsMountConfig, VfsNode } from "./vfs.types";

export type VfsNodeMountExtRow = VfsMountConfig & {
  nodeId: string;
  mountId: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type LocalPageCursor = {
  lastName: string;
  lastNodeId: string;
};

export type ListChildrenPageLocalInput = {
  mountId?: string;
  parentId: string | null;
  limit: number;
  cursor?: LocalPageCursor;
};

export type ListChildrenPageLocalOutput = {
  items: VfsNode[];
  nextCursor?: LocalPageCursor;
};

export type VfsPageCacheRow = {
  cacheKey: string;
  itemsJson: string;
  nextCursor: string | null;
  expiresAtMs: number;
};

export type VfsRepository = {
  close: () => void;

  upsertNodeMountExt: (row: VfsNodeMountExtRow) => void;
  getNodeMountExtByMountId: (mountId: string) => VfsNodeMountExtRow | null;

  upsertNodes: (rows: VfsNode[]) => void;
  listNodesByMountId: (mountId: string) => VfsNode[];
  getNodeById: (nodeId: string) => VfsNode | null;
  listChildrenPageLocal: (input: ListChildrenPageLocalInput) => ListChildrenPageLocalOutput;

  upsertPageCache: (row: VfsPageCacheRow) => void;
  getPageCacheIfFresh: (cacheKey: string, nowMs: number) => VfsPageCacheRow | null;
};
