import type { VfsNode } from "./vfs.types";
import type { VfsNodeMountExtRow } from "./vfs.mount.repository.types";

export type LocalPageCursor = {
  lastName: string;
  lastNodeId: string;
};

export type ListChildrenPageLocalInput = {
  mountNodeId?: string;
  parentId: string | null;
  limit: number;
  cursor?: LocalPageCursor;
};

export type ListChildrenPageLocalOutput = {
  items: VfsNode[];
  nextCursor?: LocalPageCursor;
};

export type VfsNodeEventRow = {
  id: string;
  sourceRef: string;
  mountNodeId?: string;
  mountId: string;
  parentId: string | null;
  type: "add" | "update_metadata" | "update_content" | "delete";
  node: VfsNode | null;
  createdAtMs: number;
};

export type ListNodeEventsInput = {
  limit?: number;
  types?: VfsNodeEventRow["type"][];
};

export type VfsNodeRepository = {
  close: () => void;
  subscribeNodeChanges: (listener: (row: VfsNode) => void) => () => void;
  subscribeNodeEventsChanged: (listener: (mountId: string) => void) => () => void;

  upsertNodes: (rows: VfsNode[]) => void;
  listNodesByMountNodeId: (mountNodeId: string) => VfsNode[];
  getNodeByMountNodeIdAndSourceRef: (mountNodeId: string, sourceRef: string) => VfsNode | null;
  getNodeById: (nodeId: string) => VfsNode | null;
  listChildrenPageLocal: (input: ListChildrenPageLocalInput) => ListChildrenPageLocalOutput;

  insertNodeEvents: (rows: Array<Omit<VfsNodeEventRow, "id">>) => void;
  listNodeEvents: (input?: ListNodeEventsInput) => VfsNodeEventRow[];
  getQueueProgressByMountId: (mountId: string) => {
    pendingUnits: number;
  };
  deleteNodeEvents: (rows: Array<Pick<VfsNodeEventRow, "id" | "mountId">>) => void;
};

export type VfsRepository = VfsNodeRepository & {
  upsertNodeMountExt: (row: VfsNodeMountExtRow) => void;
  listNodeMountExts: () => VfsNodeMountExtRow[];
  deleteNodeMountExtByMountId: (mountId: string) => void;
  getNodeMountExtByMountId: (mountId: string) => VfsNodeMountExtRow | null;
};
