import type {
  VfsOperationCore,
} from "./vfs.service.types";

export type ProviderCapabilities = {
  watch: boolean;
};

export type VfsProviderAdapter = VfsOperationCore & {
  readonly type: string;
  readonly capabilities: ProviderCapabilities;
};
