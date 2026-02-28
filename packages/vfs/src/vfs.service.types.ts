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
  watch?: (input: {
    onEvent: (event: VfsChangeEvent) => void;
  }) => Promise<{ close: () => Promise<void> }>;
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
};

export type VfsChangeEvent = {
  type: "add" | "update_metadata" | "update_content" | "delete";
  id: string;
  parentId: string | null;
};

export type VfsService = VfsOperationCore & {
  watch: (input: {
    onEvent: (event: VfsChangeEvent) => void;
  }) => Promise<{ close: () => Promise<void> }>;
  start: () => Promise<void>;
  close: () => Promise<void>;
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
