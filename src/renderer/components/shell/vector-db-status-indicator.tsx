import { Database } from "lucide-react";
import type { RendererVectorDbStatus } from "../../../shared/vector-db-status";
import { cn } from "@/lib/utils";
import { StatusTooltip } from "./status-tooltip";

function formatCompactCount(value: number | null): string {
  if (value === null) {
    return "--";
  }
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatFullCount(value: number | null): string {
  if (value === null) {
    return "--";
  }
  return new Intl.NumberFormat("en-US").format(value);
}

export function VectorDbStatusIndicator({ status }: { status: RendererVectorDbStatus }) {
  const tone = status.available
    ? "border-slate-300 bg-slate-100 text-slate-700"
    : "border-slate-300 bg-slate-200 text-slate-500";

  return (
    <div className="group relative">
      <button
        aria-label="Vector database chunk count"
        className={cn(
          "inline-flex h-10 w-10 items-center justify-center rounded-full border shadow-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300",
          tone
        )}
        data-testid="global-vectordb-status-indicator"
        type="button"
      >
        <Database className="h-4 w-4" />
      </button>

      <StatusTooltip title="Vector DB">
        <p className="text-xs text-slate-500">{formatCompactCount(status.chunkCount)}</p>
        <p className="mt-1 text-sm font-medium text-slate-800">{formatFullCount(status.chunkCount)} chunks</p>
        {status.error ? <p className="mt-1 text-xs text-rose-600">{status.error}</p> : null}
        {status.lastUpdatedAt ? (
          <p className="mt-1 text-xs text-slate-500">Updated {status.lastUpdatedAt}</p>
        ) : null}
      </StatusTooltip>
    </div>
  );
}
