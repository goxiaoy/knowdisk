import { useEffect, useMemo, useState } from "react";
import type { IndexingStatus } from "../../../core/indexing/indexing.service.types";
import type { ModelDownloadStatus } from "../../../core/model/model-download.service.types";
import {
  getIndexStatusFromBun,
  getModelDownloadStatusFromBun,
} from "../../services/bun.rpc";

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

const EMPTY_MODEL_STATUS: ModelDownloadStatus = {
  phase: "idle",
  triggeredBy: "",
  lastStartedAt: "",
  lastFinishedAt: "",
  progressPct: 0,
  error: "",
  tasks: [],
};

export function IndexRunBadge({
  pollMs = 1000,
  onClick,
  loadStatus = getIndexStatusFromBun,
  loadModelStatus = getModelDownloadStatusFromBun,
}: {
  pollMs?: number;
  onClick?: () => void;
  loadStatus?: () => Promise<IndexingStatus | null>;
  loadModelStatus?: () => Promise<ModelDownloadStatus | null>;
}) {
  const [status, setStatus] = useState<IndexingStatus>(EMPTY_STATUS);
  const [modelStatus, setModelStatus] =
    useState<ModelDownloadStatus>(EMPTY_MODEL_STATUS);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [nextIndex, nextModel] = await Promise.all([
        loadStatus(),
        loadModelStatus(),
      ]);
      if (!cancelled && nextIndex) {
        setStatus(nextIndex);
      }
      if (!cancelled && nextModel) {
        setModelStatus(nextModel);
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
  }, [loadModelStatus, loadStatus, pollMs]);

  const { label, className } = useMemo(() => {
    if (modelStatus.phase === "running") {
      return {
        label: `Model: ${modelStatus.progressPct}%`,
        className: "bg-sky-100 text-sky-700",
      };
    }
    if (modelStatus.phase === "failed") {
      return {
        label: "Model: Failed",
        className: "bg-rose-100 text-rose-700",
      };
    }
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
  }, [modelStatus, status]);

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
