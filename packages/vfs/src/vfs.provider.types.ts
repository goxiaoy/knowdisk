import type {
  VfsOperationCore,
} from "./vfs.service.types";

export const VFS_PROVIDER_OPERATIONS_READY = true;

export type ProviderCapabilities = {
  watch: boolean;
};

export type VfsProviderAdapter = VfsOperationCore & {
  readonly type: string;
  readonly capabilities: ProviderCapabilities;
};
