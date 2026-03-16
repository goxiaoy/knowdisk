import { Cpu } from "lucide-react";
import type { RendererModelStatus } from "../../../shared/model-status";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function phaseStyle(phase: RendererModelStatus["phase"], available: boolean) {
  if (!available) {
    return {
      ring: "border-slate-300 bg-slate-200 text-slate-500",
      progressTrack: "stroke-slate-300",
      progressFill: "stroke-slate-500",
    };
  }

  switch (phase) {
    case "running":
    case "verifying":
      return {
        ring: "border-cyan-200 bg-cyan-50 text-cyan-700",
        progressTrack: "stroke-cyan-200",
        progressFill: "stroke-cyan-500",
      };
    case "completed":
      return {
        ring: "border-emerald-200 bg-emerald-50 text-emerald-700",
        progressTrack: "stroke-emerald-200",
        progressFill: "stroke-emerald-500",
      };
    case "failed":
      return {
        ring: "border-rose-200 bg-rose-50 text-rose-700",
        progressTrack: "stroke-rose-200",
        progressFill: "stroke-rose-500",
      };
    default:
      return {
        ring: "border-slate-300 bg-slate-100 text-slate-600",
        progressTrack: "stroke-slate-300",
        progressFill: "stroke-slate-500",
      };
  }
}

function formatTaskState(state: string): string {
  return state.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function TaskRow({ label, state, progressPct }: { label: string; state: string; progressPct: number }) {
  const visualPct = Math.max(0, Math.min(100, progressPct));

  return (
    <Card className="rounded-xl border-slate-100 bg-slate-50/70 shadow-none">
      <CardContent className="px-2.5 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-xs text-slate-500">{formatTaskState(state)}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-slate-500 transition-all duration-300" style={{ width: `${visualPct}%` }} />
      </div>
      <div className="mt-1 text-right text-xs font-medium text-slate-600">{visualPct}%</div>
      </CardContent>
    </Card>
  );
}

export function StatusIndicator({ status }: { status: RendererModelStatus }) {
  const styles = phaseStyle(status.phase, status.available);
  const progress = Math.max(0, Math.min(100, status.progressPct));
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress / 100);

  return (
    <div className="group relative">
      <button
        aria-label="Background model task status"
        className={cn(
          "relative inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border shadow-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
          styles.ring
        )}
        data-testid="global-status-indicator"
        type="button"
      >
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -rotate-90"
          viewBox="0 0 40 40"
        >
          <circle
            className={cn("fill-none", styles.progressTrack)}
            cx="20"
            cy="20"
            r={radius}
            strokeWidth="3"
          />
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
        <Cpu className="h-4 w-4" />
      </button>

      <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-72 rounded-2xl border border-slate-200 bg-white p-3 opacity-0 shadow-[0_12px_28px_rgba(15,23,42,0.12)] transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Model Tasks</p>
          <span className="text-xs font-medium text-slate-700">{status.progressPct}%</span>
        </div>

        {!status.available ? (
          <p className="text-sm text-slate-500">Unavailable</p>
        ) : (
          <div className="space-y-2">
            <TaskRow
              label="Embedding"
              progressPct={status.tasks.embedding?.progressPct ?? 0}
              state={status.tasks.embedding?.state ?? "not started"}
            />
            <TaskRow
              label="Reranker"
              progressPct={status.tasks.reranker?.progressPct ?? 0}
              state={status.tasks.reranker?.state ?? "not started"}
            />
          </div>
        )}
      </div>
    </div>
  );
}
