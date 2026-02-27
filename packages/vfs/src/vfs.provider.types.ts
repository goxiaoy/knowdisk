import type { VfsMountConfig, VfsNodeKind } from "./vfs.types";
import type {
  CreateReadStreamOperation,
  GetMetadataOperation,
  ListChildrenOperation,
} from "./vfs.service.types";

export const VFS_PROVIDER_OPERATIONS_READY = true;

export type ProviderCapabilities = {
  watch: boolean;
};

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

export type VfsProviderAdapter = {
  readonly type: string;
  readonly capabilities: ProviderCapabilities;

  listChildren: ListChildrenOperation;
  createReadStream?: CreateReadStreamOperation;
  getMetadata?: GetMetadataOperation;

  watch?: (input: {
    mount: VfsMountConfig;
    onEvent: (event: {
      type: "add" | "update" | "delete";
      sourceRef: string;
      parentSourceRef: string | null;
    }) => void;
  }) => Promise<{ close: () => Promise<void> }>;
};
