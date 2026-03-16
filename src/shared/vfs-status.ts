export type VfsMountPhase = "idle" | "metadata" | "content" | "error";

export type RendererVfsMountStatus = {
  mountId: string;
  name: string;
  phase: VfsMountPhase;
  pendingUnits: number;
  error: string;
};

export type RendererVfsStatus = {
  available: boolean;
  phase: "idle" | "syncing" | "error";
  error: string;
  syncingMounts: number;
  mounts: RendererVfsMountStatus[];
};

export const FALLBACK_VFS_STATUS: RendererVfsStatus = {
  available: false,
  phase: "idle",
  error: "",
  syncingMounts: 0,
  mounts: [],
};
