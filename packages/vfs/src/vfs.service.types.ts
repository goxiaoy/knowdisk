import type {
  VfsMount,
  VfsMountConfig,
  VfsNode,
  WalkChildrenInput,
  WalkChildrenOutput,
} from "./vfs.types";

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
  create?: (input: {
    parentId: string | null;
    name?: string;
    kind?: "file" | "folder";
  }) => Promise<VfsNode>;
  rename?: (input: { id: string; name: string }) => Promise<VfsNode>;
  delete?: (input: { id: string }) => Promise<void>;
  getMetadata: (input: { id: string }) => Promise<VfsNode | null>;
  getVersion?: (input: { id: string }) => Promise<string | null>;
};

export type VfsChangeEvent = {
  type: "add" | "update" | "delete";
  id: string;
  parentId: string | null;
  contentUpdated: boolean | null;
  metadataChanged: boolean | null;
};

export type VfsService = VfsOperationCore & {
  subscribeNodeChanges: (listener: (row: VfsNode) => void) => () => void;
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
