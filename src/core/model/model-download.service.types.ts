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

export type ModelDownloadTasks = {
  embedding: ModelDownloadTask | null;
  reranker: ModelDownloadTask | null;
};

export type ModelDownloadStatus = {
  phase: "idle" | "verifying" | "running" | "completed" | "failed";
  triggeredBy: string;
  lastStartedAt: string;
  lastFinishedAt: string;
  progressPct: number;
  error: string;
  tasks: ModelDownloadTasks;
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

export type LocalEmbeddingExtractor = (
  text: string,
  opts: { pooling: "mean"; normalize: true },
) => Promise<{ data?: ArrayLike<number> }>;

export type LocalRerankerInputs = Record<string, unknown>;

export type LocalRerankerRuntime = {
  tokenizePairs: (query: string, docs: string[]) => Promise<LocalRerankerInputs>;
  score: (inputs: LocalRerankerInputs) => Promise<number[]>;
};

export type ModelDownloadService = {
  ensureRequiredModels: () => Promise<void>;
  getLocalEmbeddingExtractor: () => Promise<LocalEmbeddingExtractor>;
  getLocalRerankerRuntime: () => Promise<LocalRerankerRuntime>;
  retryNow: () => Promise<{ ok: boolean; reason: string }>;
  redownloadModel: (
    taskId: "embedding-local" | "reranker-local",
  ) => Promise<{ ok: boolean; reason: string }>;
  getStatus: () => ModelDownloadStatusStore;
};
