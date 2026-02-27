import type {
  VfsMount,
  VfsMountConfig,
  VfsNodeKind,
  WalkChildrenInput,
  WalkChildrenOutput,
} from "./vfs.types";

export const VFS_OPERATION_SERVICE_READY = true;

export type ListChildrenItem = {
  sourceRef: string;
  parentSourceRef: string | null;
  name: string;
  kind: VfsNodeKind;
  title?: string;
  size?: number;
  mtimeMs?: number;
  providerVersion?: string;
};

export type ListChildrenResult = {
  items: ListChildrenItem[];
  nextCursor?: string;
};

export type ListChildrenOperation = (input: {
  mount: VfsMount;
  parentSourceRef: string | null;
  limit: number;
  cursor?: string;
}) => Promise<ListChildrenResult>;

export type CreateReadStreamOperation = (input: {
  mount: VfsMount;
  sourceRef: string;
  offset?: number;
  length?: number;
}) => Promise<ReadableStream<Uint8Array>>;

export type VfsService = {
  mount: (config: VfsMountConfig) => Promise<VfsMount>;
  mountInternal: (mountId: string, config: VfsMountConfig) => Promise<VfsMount>;
  unmount: (mountId: string) => Promise<void>;

  listChildren: ListChildrenOperation;

  triggerReconcile: (mountId: string) => Promise<void>;
  createReadStream: CreateReadStreamOperation;
};

export type VfsOperationService = {
  vfs: VfsService;
  walkChildren: (input: WalkChildrenInput) => Promise<WalkChildrenOutput>;
};
