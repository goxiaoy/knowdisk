import { Cloud } from "lucide-react";
import type { RendererVfsStatus } from "../../../shared/vfs-status";
import { cn } from "@/lib/utils";
import { StatusTooltip } from "./status-tooltip";

function phaseStyle(phase: RendererVfsStatus["phase"], available: boolean) {
  if (!available) {
    return {
      ring: "border-slate-300 bg-slate-200 text-slate-500",
    };
  }
  if (phase === "error") {
    return {
      ring: "border-rose-200 bg-rose-50 text-rose-700",
    };
  }
  if (phase === "syncing") {
    return {
      ring: "border-indigo-200 bg-indigo-50 text-indigo-700",
    };
  }
  return {
    ring: "border-slate-300 bg-slate-100 text-slate-600",
  };
}

function formatMountPhase(phase: string): string {
  if (phase === "metadata") return "Metadata";
  if (phase === "content") return "Content";
  if (phase === "error") return "Error";
  return "Idle";
}

export function VfsStatusIndicator({ status }: { status: RendererVfsStatus }) {
  const isHealthyIdle =
    status.available &&
    status.phase === "idle" &&
    status.mounts.length > 0 &&
    status.mounts.every((mount) => mount.pendingUnits === 0 && !mount.error);
  const styles = isHealthyIdle
    ? {
        ring: "border-emerald-200 bg-emerald-50 text-emerald-700",
      }
    : phaseStyle(status.phase, status.available);

  return (
    <div className="group relative">
      <button
        aria-label="Cloud sync status"
        className={cn(
          "relative inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border shadow-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
          styles.ring
        )}
        data-testid="global-vfs-status-indicator"
        type="button"
      >
        <Cloud className="h-4 w-4" />
      </button>

      <StatusTooltip title="Cloud Sync">
        {!status.available ? (
          <p className="text-sm text-slate-500">Unavailable</p>
        ) : status.mounts.length === 0 ? (
          <p className="text-sm text-slate-500">No mounted directories</p>
        ) : (
          <div className="space-y-2">
            {status.mounts.slice(0, 4).map((mount) => (
              <div key={mount.mountId} className="rounded-xl border border-slate-100 bg-slate-50/70 px-2.5 py-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-700">{mount.name}</span>
                  <span className="text-xs text-slate-500">{formatMountPhase(mount.phase)}</span>
                </div>
                <p className="mb-1 text-xs text-slate-500">{`${mount.pendingUnits} items pending`}</p>
              </div>
            ))}
            {status.mounts.length > 4 ? (
              <p className="text-right text-xs text-slate-500">+{status.mounts.length - 4} more mounts</p>
            ) : null}
          </div>
        )}
      </StatusTooltip>
    </div>
  );
}
