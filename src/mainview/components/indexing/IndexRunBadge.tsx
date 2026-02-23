import { useEffect, useMemo, useState } from "react";
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

export function IndexRunBadge({
  pollMs = 1000,
  onClick,
  loadStatus = getIndexStatusFromBun,
}: {
  pollMs?: number;
  onClick?: () => void;
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

  const { label, className } = useMemo(() => {
    if (status.worker.phase === "failed" || status.run.errors.length > 0) {
      return {
        label: "Index: Failed",
        className: "bg-rose-100 text-rose-700",
      };
    }
    if (status.run.phase === "running" || status.scheduler.phase !== "idle" || status.worker.runningWorkers > 0) {
      return {
        label: `Index: Running (${status.worker.runningWorkers})`,
        className: "bg-amber-100 text-amber-700",
      };
    }
    return {
      label: "Index: Idle",
      className: "bg-emerald-100 text-emerald-700",
    };
  }, [status]);

  return (
    <button
      data-testid="global-index-badge"
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${className}`}
      title="Open Status page"
    >
      {label}
    </button>
  );
}
