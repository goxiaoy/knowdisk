import { useEffect, useMemo, useState } from "react";
import type { ModelDownloadStatus } from "../../../core/model/model-download.service.types";
import { getModelDownloadStatusFromBun } from "../../services/bun.rpc";

const EMPTY_STATUS: ModelDownloadStatus = {
  phase: "idle",
  triggeredBy: "",
  lastStartedAt: "",
  lastFinishedAt: "",
  progressPct: 0,
  error: "",
  tasks: [],
};

export function ModelDownloadCard({
  pollMs = 1000,
  loadStatus = getModelDownloadStatusFromBun,
}: {
  pollMs?: number;
  loadStatus?: () => Promise<ModelDownloadStatus | null>;
}) {
  const [status, setStatus] = useState<ModelDownloadStatus>(EMPTY_STATUS);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next = await loadStatus();
      if (!cancelled && next) {
        setStatus(next);
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [loadStatus, pollMs]);

  const badgeClass = useMemo(() => {
    if (status.phase === "failed") {
      return "bg-rose-100 text-rose-700";
    }
    if (status.phase === "running") {
      return "bg-amber-100 text-amber-700";
    }
    if (status.phase === "completed") {
      return "bg-emerald-100 text-emerald-700";
    }
    return "bg-slate-100 text-slate-700";
  }, [status.phase]);

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Model Downloads</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${badgeClass}`}>
          {status.phase}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-700">
        <div>
          <dt className="text-slate-500">Progress</dt>
          <dd data-testid="model-download-progress" className="font-medium text-slate-900">
            {status.progressPct}%
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Triggered By</dt>
          <dd data-testid="model-download-triggered-by" className="font-medium text-slate-900">
            {status.triggeredBy || "-"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Started At</dt>
          <dd data-testid="model-download-started-at" className="font-medium text-slate-900">
            {status.lastStartedAt || "-"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Finished At</dt>
          <dd data-testid="model-download-finished-at" className="font-medium text-slate-900">
            {status.lastFinishedAt || "-"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Error</dt>
          <dd data-testid="model-download-error" className="font-medium text-rose-700 break-all">
            {status.error || "-"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Tasks</dt>
          <dd data-testid="model-download-tasks" className="font-medium text-slate-900">
            {status.tasks.length === 0 ? (
              <span>-</span>
            ) : (
              <ul className="list-disc space-y-1 pl-5">
                {status.tasks.map((task) => (
                  <li key={task.id} className="break-all">
                    {task.id} | {task.model} | {task.state} | {task.progressPct}%
                    {task.error ? ` | ${task.error}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </article>
  );
}
