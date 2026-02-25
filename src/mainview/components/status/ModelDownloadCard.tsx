import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelDownloadStatus } from "../../../core/model/model-download.service.types";
import {
  getModelDownloadStatusFromBun,
  redownloadModelInBun,
  retryModelDownloadInBun,
} from "../../services/bun.rpc";

const EMPTY_STATUS: ModelDownloadStatus = {
  phase: "idle",
  lastStartedAt: "",
  lastFinishedAt: "",
  progressPct: 0,
  error: "",
  tasks: {
    embedding: null,
    reranker: null,
  },
  retry: {
    attempt: 0,
    maxAttempts: 3,
    backoffMs: [3000, 10000, 30000],
    nextRetryAt: "",
    exhausted: false,
  },
};

export function ModelDownloadCard({
  pollMs = 1000,
  loadStatus = getModelDownloadStatusFromBun,
  retryNow = retryModelDownloadInBun,
  redownloadModel = redownloadModelInBun,
}: {
  pollMs?: number;
  loadStatus?: () => Promise<ModelDownloadStatus | null>;
  retryNow?: () => Promise<{ ok: boolean } | null>;
  redownloadModel?: (
    taskId: "embedding-local" | "reranker-local",
  ) => Promise<{ ok: boolean } | null>;
}) {
  const [status, setStatus] = useState<ModelDownloadStatus>(EMPTY_STATUS);
  const [retryMessage, setRetryMessage] = useState("");
  const [downloadSpeedBps, setDownloadSpeedBps] = useState(0);
  const lastProgressRef = useRef<{ atMs: number; downloadedBytes: number } | null>(null);

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

  const retryCountdownText = useMemo(() => {
    if (!status.retry.nextRetryAt) {
      return "-";
    }
    const target = new Date(status.retry.nextRetryAt).getTime();
    const remainingMs = Math.max(0, target - Date.now());
    return `${Math.ceil(remainingMs / 1000)}s`;
  }, [status.retry.nextRetryAt, status.lastStartedAt, status.lastFinishedAt, status.progressPct]);

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

  const taskList = useMemo(
    () => [status.tasks.embedding, status.tasks.reranker].filter((task) => task !== null),
    [status.tasks.embedding, status.tasks.reranker],
  );

  const totalDownloadedBytes = useMemo(
    () => taskList.reduce((sum, task) => sum + task.downloadedBytes, 0),
    [taskList],
  );
  const totalBytes = useMemo(
    () => taskList.reduce((sum, task) => sum + Math.max(0, task.totalBytes), 0),
    [taskList],
  );
  const remainingBytes = Math.max(0, totalBytes - totalDownloadedBytes);

  useEffect(() => {
    const now = Date.now();
    const prev = lastProgressRef.current;
    if (!prev) {
      lastProgressRef.current = { atMs: now, downloadedBytes: totalDownloadedBytes };
      setDownloadSpeedBps(0);
      return;
    }
    const elapsedMs = now - prev.atMs;
    const deltaBytes = totalDownloadedBytes - prev.downloadedBytes;
    if (elapsedMs <= 0) {
      return;
    }
    const instantBps = deltaBytes > 0 ? (deltaBytes * 1000) / elapsedMs : 0;
    setDownloadSpeedBps((prevSpeed) =>
      prevSpeed > 0 ? prevSpeed * 0.65 + instantBps * 0.35 : instantBps,
    );
    lastProgressRef.current = { atMs: now, downloadedBytes: totalDownloadedBytes };
  }, [totalDownloadedBytes]);

  const etaSeconds = useMemo(() => {
    if (downloadSpeedBps <= 0 || remainingBytes <= 0) {
      return null;
    }
    return Math.ceil(remainingBytes / downloadSpeedBps);
  }, [downloadSpeedBps, remainingBytes]);

  const hasParseFailure = useMemo(() => {
    const allErrorText = [status.error, ...taskList.map((task) => task.error)]
      .join(" ")
      .toLowerCase();
    return (
      allErrorText.includes("protobuf parsing failed") ||
      allErrorText.includes("invalid protobuf") ||
      allErrorText.includes("verify_embedding") ||
      allErrorText.includes("verify_reranker")
    );
  }, [status.error, taskList]);

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Model Downloads</h2>
        <div className="flex items-center gap-2">
          {status.phase === "failed" ? (
            <button
              data-testid="model-download-retry-now"
              type="button"
              onClick={() => {
                void retryNow().then((result) => {
                  if (!result) {
                    setRetryMessage("Retry request failed.");
                    return;
                  }
                  setRetryMessage(result.ok ? "Retry started." : "Retry not started.");
                });
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Retry now
            </button>
          ) : null}
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${badgeClass}`}>
            {status.phase}
          </span>
        </div>
      </div>
      {retryMessage ? <p className="mt-2 text-xs text-slate-600">{retryMessage}</p> : null}
      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-700">
        <div>
          <dt className="text-slate-500">Progress</dt>
          <dd data-testid="model-download-progress" className="font-medium text-slate-900">
            {status.progressPct}%
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
          <dt className="text-slate-500">Download Speed</dt>
          <dd data-testid="model-download-speed" className="font-medium text-slate-900">
            {downloadSpeedBps > 0 ? `${formatBytes(downloadSpeedBps)}/s` : "-"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Remaining Size</dt>
          <dd data-testid="model-download-remaining-size" className="font-medium text-slate-900">
            {totalBytes > 0 ? formatBytes(remainingBytes) : "-"}
            {etaSeconds ? ` (ETA ${formatEta(etaSeconds)})` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Retry</dt>
          <dd data-testid="model-download-retry" className="font-medium text-slate-900">
            attempt {status.retry.attempt}/{status.retry.maxAttempts}
            {status.retry.exhausted ? " | exhausted" : ""}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Next Auto Retry</dt>
          <dd data-testid="model-download-next-retry" className="font-medium text-slate-900">
            {status.retry.nextRetryAt ? `${status.retry.nextRetryAt} (${retryCountdownText})` : "-"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Tasks</dt>
          <dd data-testid="model-download-tasks" className="font-medium text-slate-900">
            {taskList.length === 0 ? (
              <span>-</span>
            ) : (
              <ul className="list-disc space-y-1 pl-5">
                {taskList.map((task) => (
                  <li key={task.id} className="break-all">
                    {task.id} | {task.model} | {task.state} | {task.progressPct}%
                    {task.error ? ` | ${task.error}` : ""}
                    {status.phase === "failed" && task.state === "failed" && hasParseFailure ? (
                      <button
                        type="button"
                        className="ml-2 rounded-md border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                        onClick={() => {
                          void redownloadModel(task.id).then((result) => {
                            if (!result) {
                              setRetryMessage("Redownload request failed.");
                              return;
                            }
                            setRetryMessage(
                              result.ok
                                ? `Redownload started for ${task.id}.`
                                : "Redownload not started.",
                            );
                          });
                        }}
                      >
                        Redownload
                      </button>
                    ) : null}
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

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = size >= 100 || unit === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unit]}`;
}

function formatEta(seconds: number) {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    return `${Math.ceil(seconds / 60)}m`;
  }
  return `${Math.ceil(seconds / 3600)}h`;
}
