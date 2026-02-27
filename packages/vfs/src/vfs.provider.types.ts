import type { VfsMountConfig, VfsNodeKind } from "./vfs.types";

export type ProviderCapabilities = {
  watch: boolean;
};

export type ProviderListChildrenItem = {
  sourceRef: string;
  parentSourceRef: string | null;
  name: string;
  kind: VfsNodeKind;
  title?: string;
  size?: number;
  mtimeMs?: number;
  providerVersion?: string;
};

export type ProviderListChildrenResult = {
  items: ProviderListChildrenItem[];
  nextCursor?: string;
};

export type VfsProviderAdapter = {
  readonly type: string;
  readonly capabilities: ProviderCapabilities;

  listChildren: (input: {
    mount: VfsMountConfig;
    parentSourceRef: string | null;
    limit: number;
    cursor?: string;
  }) => Promise<ProviderListChildrenResult>;

  watch?: (input: {
    mount: VfsMountConfig;
    onEvent: (event: {
      type: "upsert" | "delete";
      sourceRef: string;
      parentSourceRef: string | null;
    }) => void;
  }) => Promise<{ close: () => Promise<void> }>;
};
