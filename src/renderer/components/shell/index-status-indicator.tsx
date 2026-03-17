import { ScanSearch } from "lucide-react";
import type { RendererIndexStatus } from "../../../shared/index-status";
import { cn } from "@/lib/utils";
import { StatusTooltip } from "./status-tooltip";

function phaseStyle(phase: RendererIndexStatus["phase"], available: boolean) {
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
  if (phase === "indexing" || phase === "rebuilding") {
    return {
      ring: "border-amber-200 bg-amber-50 text-amber-700",
      progressTrack: "stroke-amber-200",
      progressFill: "stroke-amber-500",
    };
  }
  return {
    ring: "border-slate-300 bg-slate-100 text-slate-600",
    progressTrack: "stroke-slate-300",
    progressFill: "stroke-slate-500",
  };
}

function getProgress(status: RendererIndexStatus): number {
  if (status.totalFiles <= 0) {
    return status.phase === "idle" && status.available ? 100 : 0;
  }
  return Math.max(0, Math.min(100, Math.round((status.processedFiles / status.totalFiles) * 100)));
}

function getSummary(status: RendererIndexStatus): string {
  if (!status.available) {
    return "Unavailable";
  }
  if (status.phase === "error") {
    return status.error || "Error";
  }
  if (status.phase === "rebuilding") {
    return `${status.processedFiles} / ${status.totalFiles}`;
  }
  if (status.phase === "indexing") {
    return status.queueDepth > 0 ? `Indexing (${status.queueDepth} queued)` : "Indexing";
  }
  return "Idle";
}

export function IndexStatusIndicator({ status }: { status: RendererIndexStatus }) {
  const styles = phaseStyle(status.phase, status.available);
  const progress = getProgress(status);
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress / 100);

  return (
    <div className="group relative">
      <button
        aria-label="Index status"
        className={cn(
          "relative inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border shadow-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300",
          styles.ring
        )}
        data-testid="global-index-status-indicator"
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
        <ScanSearch className="h-4 w-4" />
      </button>

      <StatusTooltip title="Index">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-700">{progress}%</span>
        </div>
        <p className="text-sm font-medium text-slate-800">{getSummary(status)}</p>
        {status.phase !== "idle" && status.queueDepth > 0 ? (
          <p className="mt-1 text-xs text-slate-500">{status.queueDepth} jobs remaining</p>
        ) : null}
        {status.activeNodeName ? (
          <p className="mt-1 truncate text-xs text-slate-500">{status.activeNodeName}</p>
        ) : null}
      </StatusTooltip>
    </div>
  );
}
