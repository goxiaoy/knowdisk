export const VFS_TYPES_READY = true;

export type VfsNodeKind = "mount" | "file" | "folder";
export type VfsNodeRequiredField = "size" | "providerVersion" | "mtimeMs";

export type VfsMountConfig = {
  providerType: string;
  providerExtra: Record<string, unknown>;
  autoSync?: boolean;
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
  kind: VfsNodeKind;
  size: number | null;
  mtimeMs: number | null;
  sourceRef: string;
  providerVersion: string | null;
  deletedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export function complete(
  node: Pick<VfsNode, VfsNodeRequiredField>,
  requiredFields: VfsNodeRequiredField[],
): boolean {
  for (const field of requiredFields) {
    if (field === "size") {
      if (typeof node.size !== "number" || node.size <= 0) {
        return false;
      }
      continue;
    }
    if (field === "mtimeMs") {
      if (node.mtimeMs === null) {
        return false;
      }
      continue;
    }
    if (field === "providerVersion") {
      if (typeof node.providerVersion !== "string" || node.providerVersion.length === 0) {
        return false;
      }
    }
  }
  return true;
}

export type VfsCursor = {
  mode: "local" | "remote";
  token: string;
};

export type WalkChildrenInput = {
  parentNodeId: string | null;
  limit: number;
  cursor?: VfsCursor;
};

export type WalkChildrenOutput = {
  items: VfsNode[];
  nextCursor?: VfsCursor;
  source: "local" | "remote";
};
