import type { VfsMount, VfsNode } from "./vfs.types";

export type VfsMountRow = VfsMount & {
  lastReconcileAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type LocalPageCursor = {
  lastName: string;
  lastNodeId: string;
};

export type ListChildrenPageLocalInput = {
  mountId: string;
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

  upsertMount: (row: VfsMountRow) => void;
  getMountById: (mountId: string) => VfsMountRow | null;

  upsertNodes: (rows: VfsNode[]) => void;
  listNodesByMountId: (mountId: string) => VfsNode[];
  getNodeByVpath: (vpath: string) => VfsNode | null;
  listChildrenPageLocal: (input: ListChildrenPageLocalInput) => ListChildrenPageLocalOutput;

  upsertPageCache: (row: VfsPageCacheRow) => void;
  getPageCacheIfFresh: (cacheKey: string, nowMs: number) => VfsPageCacheRow | null;
};
