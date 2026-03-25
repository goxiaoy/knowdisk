import { Cpu } from "lucide-react";
import type { RendererModelStatus } from "../../../shared/model-status";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { StatusTooltip } from "./status-tooltip";

const TASK_LABELS: Record<string, string> = {
  embedding: "Embedding",
  reranker: "Reranker",
  ocr: "OCR",
  caption: "Caption",
};

const TASK_PRIORITY: Record<string, number> = {
  embedding: 0,
  reranker: 1,
  ocr: 2,
  caption: 3,
};

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

function formatTaskLabel(taskKey: string): string {
  return (
    TASK_LABELS[taskKey] ??
    taskKey.replaceAll(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

function getOrderedTasks(tasks: RendererModelStatus["tasks"]) {
  return Object.entries(tasks)
    .filter(([, task]) => task !== null)
    .sort(([leftKey], [rightKey]) => {
      const leftPriority = TASK_PRIORITY[leftKey] ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = TASK_PRIORITY[rightKey] ?? Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return leftKey.localeCompare(rightKey);
    }) as Array<[string, NonNullable<RendererModelStatus["tasks"][string]>]>;
}

function TaskRow({
  label,
  model,
  state,
  progressPct,
}: {
  label: string;
  model: string;
  state: string;
  progressPct: number;
}) {
  const visualPct = Math.max(0, Math.min(100, progressPct));

  return (
    <Card className="shadow-none rounded-xl border-slate-100 bg-slate-50/70">
      <CardContent className="px-2.5 py-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-xs text-slate-500">{formatTaskState(state)}</span>
      </div>
      <div className="mb-1 truncate text-xs text-slate-500">{model}</div>
      <div className="h-1.5 w-full rounded-full bg-slate-200">
        <div className="h-full transition-all duration-300 rounded-full bg-slate-500" style={{ width: `${visualPct}%` }} />
      </div>
      <div className="mt-1 text-xs font-medium text-right text-slate-600">{visualPct}%</div>
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
  const orderedTasks = getOrderedTasks(status.tasks);

  return (
    <div className="relative group">
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
          className="absolute inset-0 -rotate-90 pointer-events-none"
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
        <Cpu className="w-4 h-4" />
      </button>

      <StatusTooltip title="Model Status">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-700">{status.progressPct}%</span>
        </div>

        {!status.available ? (
          <p className="text-sm text-slate-500">Unavailable</p>
        ) : orderedTasks.length === 0 ? (
          <p className="text-sm text-slate-500">No model tasks yet</p>
        ) : (
          <div className="space-y-2">
            {orderedTasks.map(([taskKey, task]) => (
              <TaskRow
                key={taskKey}
                label={formatTaskLabel(taskKey)}
                model={task.model}
                progressPct={task.progressPct}
                state={task.state}
              />
            ))}
          </div>
        )}
      </StatusTooltip>
    </div>
  );
}
