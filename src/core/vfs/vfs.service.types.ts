import type { VfsNode, VfsMountConfig, WalkChildrenInput, WalkChildrenOutput } from "./vfs.types";

export type VfsService = {
  mount: (config: VfsMountConfig) => Promise<void>;
  unmount: (mountId: string) => Promise<void>;

  walkChildren: (input: WalkChildrenInput) => Promise<WalkChildrenOutput>;
  readMarkdown: (path: string) => Promise<{ node: VfsNode; markdown: string }>;

  triggerReconcile: (mountId: string) => Promise<void>;
};

export type VfsSyncScheduler = {
  enqueueMetadataUpsert: (input: { mountId: string; sourceRef: string }) => Promise<void>;
  enqueueMetadataDelete: (input: { mountId: string; sourceRef: string }) => Promise<void>;
  enqueueContentRefresh: (input: { nodeId: string; reason: string }) => Promise<void>;
};
