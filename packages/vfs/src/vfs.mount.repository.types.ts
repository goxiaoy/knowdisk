import type { VfsMountConfig } from "./vfs.types";

export type VfsNodeMountExtRow = VfsMountConfig & {
  nodeId: string;
  mountId: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type VfsMountRepository = {
  close: () => void;
  upsertNodeMountExt: (row: VfsNodeMountExtRow) => void;
  listNodeMountExts: () => VfsNodeMountExtRow[];
  deleteNodeMountExtByMountId: (mountId: string) => void;
  getNodeMountExtByMountId: (mountId: string) => VfsNodeMountExtRow | null;
};
