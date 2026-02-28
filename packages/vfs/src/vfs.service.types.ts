import type {
  VfsMount,
  VfsMountConfig,
  VfsNode,
  WalkChildrenInput,
  WalkChildrenOutput,
} from "./vfs.types";

export const VFS_OPERATION_SERVICE_READY = true;

export type ListChildrenItem = VfsNode;

export type ListChildrenResult = {
  items: VfsNode[];
  nextCursor?: string;
};

export type VfsOperationCore = {
  listChildren: (input: {
    parentId: string | null;
    limit: number;
    cursor?: string;
  }) => Promise<ListChildrenResult>;
  createReadStream?: (input: {
    id: string;
    offset?: number;
    length?: number;
  }) => Promise<ReadableStream<Uint8Array>>;
  getMetadata?: (input: { id: string }) => Promise<VfsNode | null>;
  watch?: (input: {
    onEvent: (event: {
      type: "add" | "update_metadata" | "update_content" | "delete";
      id: string;
      parentId: string | null;
    }) => void;
  }) => Promise<{ close: () => Promise<void> }>;
};

export type VfsService = VfsOperationCore & {
  mount: (config: VfsMountConfig) => Promise<VfsMount>;
  mountInternal: (mountId: string, config: VfsMountConfig) => Promise<VfsMount>;
  unmount: (mountId: string) => Promise<void>;
  walkChildren: (input: WalkChildrenInput) => Promise<WalkChildrenOutput>;
  triggerReconcile: (mountId: string) => Promise<void>;
};

export type VfsOperationService = {
  vfs: VfsService;
  walkChildren: (input: WalkChildrenInput) => Promise<WalkChildrenOutput>;
};
