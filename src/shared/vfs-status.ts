export type VfsMountPhase = "idle" | "metadata" | "content" | "error";

export type RendererVfsMountStatus = {
  mountId: string;
  phase: VfsMountPhase;
  progressPct: number;
  error: string;
};

export type RendererVfsStatus = {
  available: boolean;
  phase: "idle" | "syncing" | "error";
  progressPct: number;
  error: string;
  syncingMounts: number;
  mounts: RendererVfsMountStatus[];
};

export const FALLBACK_VFS_STATUS: RendererVfsStatus = {
  available: false,
  phase: "idle",
  progressPct: 0,
  error: "",
  syncingMounts: 0,
  mounts: [],
};

export function clampVfsPct(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}
