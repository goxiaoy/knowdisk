import { HardDrive } from "lucide-react";
import type { RendererVfsStatus } from "../../../shared/vfs-status";
import { cn } from "@/lib/utils";

function phaseStyle(phase: RendererVfsStatus["phase"], available: boolean) {
  if (!available) {
    return {
      ring: "border-slate-300 bg-slate-200 text-slate-500",
      progressTrack: "stroke-slate-300",
      progressFill: "stroke-slate-500",
    };
  }
  if (phase === "error") {
    return {
      ring: "border-rose-200 bg-rose-50 text-rose-700",
      progressTrack: "stroke-rose-200",
      progressFill: "stroke-rose-500",
    };
  }
  if (phase === "syncing") {
    return {
      ring: "border-indigo-200 bg-indigo-50 text-indigo-700",
      progressTrack: "stroke-indigo-200",
      progressFill: "stroke-indigo-500",
    };
  }
  return {
    ring: "border-slate-300 bg-slate-100 text-slate-600",
    progressTrack: "stroke-slate-300",
    progressFill: "stroke-slate-500",
  };
}

function formatMountPhase(phase: string): string {
  if (phase === "metadata") return "Metadata";
  if (phase === "content") return "Content";
  if (phase === "error") return "Error";
  return "Idle";
}

export function VfsStatusIndicator({ status }: { status: RendererVfsStatus }) {
  const styles = phaseStyle(status.phase, status.available);
  const progress = Math.max(0, Math.min(100, status.progressPct));
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress / 100);

  return (
    <div className="group relative">
      <button
        aria-label="VFS sync status"
        className={cn(
          "relative inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border shadow-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
          styles.ring
        )}
        data-testid="global-vfs-status-indicator"
        type="button"
      >
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 -rotate-90" viewBox="0 0 40 40">
          <circle className={cn("fill-none", styles.progressTrack)} cx="20" cy="20" r={radius} strokeWidth="3" />
          <circle
            className={cn("fill-none transition-[stroke-dashoffset] duration-300", styles.progressFill)}
            cx="20"
            cy="20"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            strokeWidth="3"
          />
        </svg>
        <HardDrive className="h-4 w-4" />
      </button>

      <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-72 rounded-2xl border border-slate-200 bg-white p-3 opacity-0 shadow-[0_12px_28px_rgba(15,23,42,0.12)] transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">VFS Sync</p>
          <span className="text-xs font-medium text-slate-700">{status.progressPct}%</span>
        </div>

        {!status.available ? (
          <p className="text-sm text-slate-500">Unavailable</p>
        ) : status.mounts.length === 0 ? (
          <p className="text-sm text-slate-500">No mounted directories</p>
        ) : (
          <div className="space-y-2">
            {status.mounts.slice(0, 4).map((mount) => (
              <div key={mount.mountId} className="rounded-xl border border-slate-100 bg-slate-50/70 px-2.5 py-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-700">{mount.mountId}</span>
                  <span className="text-xs text-slate-500">{formatMountPhase(mount.phase)}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-slate-500 transition-all duration-300"
                    style={{ width: `${Math.max(0, Math.min(100, mount.progressPct))}%` }}
                  />
                </div>
              </div>
            ))}
            {status.mounts.length > 4 ? (
              <p className="text-right text-xs text-slate-500">+{status.mounts.length - 4} more mounts</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
