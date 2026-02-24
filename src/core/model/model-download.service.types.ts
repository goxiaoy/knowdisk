import type { AppConfig } from "../config/config.types";

export type ModelDownloadTaskState =
  | "verifying"
  | "pending"
  | "downloading"
  | "ready"
  | "failed"
  | "skipped";

export type ModelDownloadTask = {
  id: "embedding-local" | "reranker-local";
  model: string;
  provider: string;
  state: ModelDownloadTaskState;
  progressPct: number;
  downloadedBytes: number;
  totalBytes: number;
  error: string;
};

export type ModelDownloadStatus = {
  phase: "idle" | "verifying" | "running" | "completed" | "failed";
  triggeredBy: string;
  lastStartedAt: string;
  lastFinishedAt: string;
  progressPct: number;
  error: string;
  tasks: ModelDownloadTask[];
  retry: {
    attempt: number;
    maxAttempts: number;
    backoffMs: number[];
    nextRetryAt: string;
    exhausted: boolean;
  };
};

export type ModelDownloadStatusStore = {
  getSnapshot: () => ModelDownloadStatus;
  subscribe: (listener: (status: ModelDownloadStatus) => void) => () => void;
};

export type ModelDownloadService = {
  ensureRequiredModels: (cfg: AppConfig, reason: string) => Promise<void>;
  ensureLocalEmbeddingModelReady: (cfg: AppConfig, reason: string) => Promise<void>;
  ensureLocalRerankerModelReady: (cfg: AppConfig, reason: string) => Promise<void>;
  retryNow: () => Promise<{ ok: boolean; reason: string }>;
  getStatus: () => ModelDownloadStatusStore;
};
