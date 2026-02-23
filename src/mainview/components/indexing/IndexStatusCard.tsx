import { useEffect, useState } from "react";
import type { IndexingStatus } from "../../../core/indexing/indexing.service.types";
import { getIndexStatusFromBun } from "../../services/bun.rpc";

const EMPTY_STATUS: IndexingStatus = {
  running: false,
  lastReason: "",
  lastRunAt: "",
  lastReconcileAt: "",
  currentFile: null,
  indexedFiles: 0,
  queueDepth: 0,
  runningWorkers: 0,
  errors: [],
};

export function IndexStatusCard({ pollMs = 1000 }: { pollMs?: number }) {
  const [status, setStatus] = useState<IndexingStatus>(EMPTY_STATUS);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next = await getIndexStatusFromBun();
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
  }, [pollMs]);

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Index Status</h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${
            status.running ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {status.running ? "running" : "idle"}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-700 md:grid-cols-2">
        <div>
          <dt className="text-slate-500">Last Reason</dt>
          <dd data-testid="index-status-reason" className="font-medium text-slate-900">
            {status.lastReason || "-"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Indexed Files</dt>
          <dd data-testid="index-status-indexed-files" className="font-medium text-slate-900">
            {status.indexedFiles}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Queue Depth</dt>
          <dd data-testid="index-status-queue-depth" className="font-medium text-slate-900">
            {status.queueDepth}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Running Workers</dt>
          <dd data-testid="index-status-running-workers" className="font-medium text-slate-900">
            {status.runningWorkers}
          </dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-slate-500">Current File</dt>
          <dd data-testid="index-status-current-file" className="font-medium text-slate-900 break-all">
            {status.currentFile || "-"}
          </dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-slate-500">Last Run At</dt>
          <dd data-testid="index-status-last-run-at" className="font-medium text-slate-900">
            {status.lastRunAt || "-"}
          </dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-slate-500">Last Reconcile At</dt>
          <dd data-testid="index-status-last-reconcile-at" className="font-medium text-slate-900">
            {status.lastReconcileAt || "-"}
          </dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-slate-500">Errors</dt>
          <dd data-testid="index-status-errors" className="font-medium text-rose-700">
            {status.errors.length === 0 ? (
              <span>0</span>
            ) : (
              <ul className="list-disc space-y-1 pl-5">
                {status.errors.map((error, index) => (
                  <li key={`${index}-${error}`} className="break-all">
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
