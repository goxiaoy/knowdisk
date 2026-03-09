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

export type VfsNodeEventRow = {
  id: string;
  sourceRef: string;
  mountId: string;
  parentId: string | null;
  type: "add" | "update_metadata" | "update_content" | "delete";
  node: VfsNode | null;
  createdAtMs: number;
};

export type VfsRepository = {
  close: () => void;
  subscribeNodeChanges: (listener: (row: VfsNode) => void) => () => void;
  subscribeNodeEventsQueued: (listener: (row: VfsNodeEventRow) => void) => () => void;

  upsertNodeMountExt: (row: VfsNodeMountExtRow) => void;
  listNodeMountExts: () => VfsNodeMountExtRow[];
  deleteNodeMountExtByMountId: (mountId: string) => void;
  getNodeMountExtByMountId: (mountId: string) => VfsNodeMountExtRow | null;

  upsertNodes: (rows: VfsNode[]) => void;
  listNodesByMountId: (mountId: string) => VfsNode[];
  listNodesByMountIdAndSourceRef: (mountId: string, sourceRef: string) => VfsNode | null;
  getNodeById: (nodeId: string) => VfsNode | null;
  listChildrenPageLocal: (input: ListChildrenPageLocalInput) => ListChildrenPageLocalOutput;

  upsertPageCache: (row: VfsPageCacheRow) => void;
  getPageCacheIfFresh: (cacheKey: string, nowMs: number) => VfsPageCacheRow | null;
  deletePageCacheByMountId: (mountId: string) => void;
  insertNodeEvents: (rows: Array<Omit<VfsNodeEventRow, "id">>) => void;
  listNodeEventsByMountId: (mountId: string, limit?: number) => VfsNodeEventRow[];
  deleteNodeEventsByIds: (ids: string[]) => void;
};
