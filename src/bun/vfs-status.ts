import type { VfsNode, VfsSyncerEvent } from "@knowdisk/vfs";
import type { RendererVfsMountStatus, RendererVfsStatus } from "../shared/vfs-status";

export async function refreshVfsMountPendingUnits(
  mountsInput: RendererVfsMountStatus[],
  getQueueProgressByMountId: (mountId: string) => Promise<{ pendingUnits: number }> | { pendingUnits: number }
): Promise<RendererVfsMountStatus[]> {
  return Promise.all(
    mountsInput.map(async (mount) => {
      const { pendingUnits } = await getQueueProgressByMountId(mount.mountId);
      return {
        ...mount,
        pendingUnits,
      };
    })
  );
}

export function applyVfsSyncerEvent(
  current: RendererVfsMountStatus,
  event: VfsSyncerEvent
): RendererVfsMountStatus {
  if (event.type === "status") {
    const nextPhase = event.payload.isSyncing ? event.payload.phase : "idle";
    return {
      ...current,
      phase: nextPhase,
      pendingUnits: nextPhase === "idle" ? 0 : current.pendingUnits,
      error: "",
    };
  }

  if (event.type === "queue_progress") {
    return {
      ...current,
      pendingUnits: event.payload.pendingUnits,
      error: "",
    };
  }

  if (event.type === "metadata_progress") {
    return {
      ...current,
      phase: "metadata",
      error: "",
    };
  }

  return {
    ...current,
    phase: "content",
    error: "",
  };
}

export function applyMountNodeChange(
  mountsInput: RendererVfsMountStatus[],
  node: VfsNode
): RendererVfsMountStatus[] {
  if (node.kind !== "mount") {
    return mountsInput;
  }
  if (node.deletedAtMs !== null) {
    return mountsInput.filter((mount) => mount.mountId !== node.mountId);
  }
  let changed = false;
  const mounts = mountsInput.map((mount) => {
    if (mount.mountId !== node.mountId) {
      return mount;
    }
    changed = true;
    if (mount.name === node.name) {
      return mount;
    }
    return {
      ...mount,
      name: node.name,
    };
  });
  if (changed) {
    return mounts;
  }
  return [
    ...mountsInput,
    {
      mountId: node.mountId,
      name: node.name,
      phase: "idle",
      pendingUnits: 0,
      error: "",
    },
  ];
}

export function recomputeVfsStatus(mountsInput: RendererVfsMountStatus[]): RendererVfsStatus {
  const mounts = [...mountsInput].sort((a, b) => a.mountId.localeCompare(b.mountId));
  const syncing = mounts.filter((item) => item.phase === "metadata" || item.phase === "content");
  const failed = mounts.find((item) => item.phase === "error");
  const phase: RendererVfsStatus["phase"] = failed
    ? "error"
    : syncing.length > 0
      ? "syncing"
      : "idle";

  return {
    available: true,
    phase,
    error: failed?.error ?? "",
    syncingMounts: syncing.length,
    mounts,
  };
}
