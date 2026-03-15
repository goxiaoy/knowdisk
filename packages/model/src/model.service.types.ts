import type { CoreConfig, LoggerService } from "@knowdisk/core";

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
  lastStartedAt: string;
  lastFinishedAt: string;
  progressPct: number;
  error: string;
  tasks: {
    embedding: ModelDownloadTask | null;
    reranker: ModelDownloadTask | null;
  };
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

export type ModelService = {
  ensureRequiredModels: () => Promise<void>;
  getLocalEmbeddingExtractor: () => Promise<LocalEmbeddingExtractor>;
  getLocalRerankerRuntime: () => Promise<LocalRerankerRuntime>;
  retryNow: () => Promise<{ ok: boolean }>;
  redownloadEmbeddingModel: () => Promise<{ ok: boolean }>;
  redownloadRerankerModel: () => Promise<{ ok: boolean }>;
  getStatus: () => ModelDownloadStatusStore;
};

export type CreateModelServiceInput = {
  logger: LoggerService;
  config: CoreConfig;
  cacheDir: string;
  deps?: {
    fetch?: typeof fetch;
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
    now?: () => string;
    loadEmbeddingExtractor?: (
      model: string,
      cacheDir: string,
      hfEndpoint: string,
    ) => Promise<LocalEmbeddingExtractor>;
    loadRerankerRuntime?: (
      model: string,
      cacheDir: string,
      hfEndpoint: string,
    ) => Promise<LocalRerankerRuntime>;
  };
};
