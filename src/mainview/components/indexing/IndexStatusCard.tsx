import { useEffect, useState } from "react";
import type { IndexingStatus } from "../../../core/indexing/indexing.service.types";
import { getIndexStatusFromBun } from "../../services/bun.rpc";

const EMPTY_STATUS: IndexingStatus = {
  run: {
    phase: "idle",
    reason: "",
    startedAt: "",
    finishedAt: "",
    lastReconcileAt: "",
    indexedFiles: 0,
    errors: [],
  },
  scheduler: {
    phase: "idle",
    queueDepth: 0,
  },
  worker: {
    phase: "idle",
    runningWorkers: 0,
    currentFiles: [],
    lastError: "",
  },
};

export function IndexStatusCard({
  pollMs = 1000,
  loadStatus = getIndexStatusFromBun,
}: {
  pollMs?: number;
  loadStatus?: () => Promise<IndexingStatus | null>;
}) {
  const [status, setStatus] = useState<IndexingStatus>(EMPTY_STATUS);

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

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Index Status</h2>
        <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${
            status.run.phase === "running"
              ? "bg-amber-100 text-amber-700"
              : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {status.run.phase}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-700 md:grid-cols-2">
        <div>
          <dt className="text-slate-500">Run Reason</dt>
          <dd data-testid="index-status-reason" className="font-medium text-slate-900">
            {status.run.reason || "-"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Indexed Files</dt>
          <dd data-testid="index-status-indexed-files" className="font-medium text-slate-900">
            {status.run.indexedFiles}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Queue Depth</dt>
          <dd data-testid="index-status-queue-depth" className="font-medium text-slate-900">
            {status.scheduler.queueDepth}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Running Workers</dt>
          <dd data-testid="index-status-running-workers" className="font-medium text-slate-900">
            {status.worker.runningWorkers}
          </dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-slate-500">Current Files</dt>
          <dd data-testid="index-status-current-file" className="font-medium text-slate-900 break-all">
            {status.worker.currentFiles.length > 0
              ? status.worker.currentFiles.join(", ")
              : "-"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Scheduler Phase</dt>
          <dd data-testid="index-status-scheduler-phase" className="font-medium text-slate-900">
            {status.scheduler.phase}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Worker Phase</dt>
          <dd data-testid="index-status-worker-phase" className="font-medium text-slate-900">
            {status.worker.phase}
          </dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-slate-500">Run Started At</dt>
          <dd data-testid="index-status-last-run-at" className="font-medium text-slate-900">
            {status.run.startedAt || "-"}
          </dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-slate-500">Last Reconcile At</dt>
          <dd data-testid="index-status-last-reconcile-at" className="font-medium text-slate-900">
            {status.run.lastReconcileAt || "-"}
          </dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-slate-500">Worker Last Error</dt>
          <dd
            data-testid="index-status-worker-last-error"
            tabIndex={0}
            className="select-text font-medium text-rose-700"
          >
            {status.worker.lastError || "-"}
          </dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-slate-500">Errors</dt>
          <dd data-testid="index-status-errors" className="font-medium text-rose-700">
            {status.run.errors.length === 0 ? (
              <span>0</span>
            ) : (
              <ul className="list-disc space-y-1 pl-5">
                {status.run.errors.map((error, index) => (
                  <li
                    key={`${index}-${error}`}
                    tabIndex={0}
                    className="break-all select-text"
                  >
                    {error}
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
