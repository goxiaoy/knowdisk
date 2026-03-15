import { EventEmitter } from "node:events";
import type {
  CreateModelServiceInput,
  LocalEmbeddingExtractor,
  LocalRerankerRuntime,
  ModelDownloadStatus,
  ModelDownloadTask,
  ModelService,
} from "./model.service.types";

const MODEL_RETRY_BACKOFF_MS = [3000, 10000, 30000];
const MODEL_RETRY_MAX_ATTEMPTS = MODEL_RETRY_BACKOFF_MS.length;

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
    maxAttempts: MODEL_RETRY_MAX_ATTEMPTS,
    backoffMs: [...MODEL_RETRY_BACKOFF_MS],
    nextRetryAt: "",
    exhausted: false,
  },
};

export function createModelService(
  input: CreateModelServiceInput,
): ModelService {
  const emitter = new EventEmitter();
  let status: ModelDownloadStatus = EMPTY_STATUS;

  function emit() {
    emitter.emit("change", status);
  }

  function updateStatus(
    updater: (current: ModelDownloadStatus) => ModelDownloadStatus,
  ) {
    status = updater(status);
    emit();
  }

  function getStatus() {
    return {
      getSnapshot: () => status,
      subscribe(listener: (next: ModelDownloadStatus) => void) {
        emitter.on("change", listener);
        return () => {
          emitter.off("change", listener);
        };
      },
    };
  }

  function buildTasks(): ModelDownloadStatus["tasks"] {
    const embedding =
      input.config.embedding.provider === "local" && input.config.embedding.local
        ? {
            id: "embedding-local",
            model: input.config.embedding.local.model,
            provider: "local",
            state: "verifying",
            progressPct: 0,
            downloadedBytes: 0,
            totalBytes: 0,
            error: "",
          }
        : null;
    const reranker =
      input.config.reranker.enabled &&
      input.config.reranker.provider === "local" &&
      input.config.reranker.local
        ? {
            id: "reranker-local",
            model: input.config.reranker.local.model,
            provider: "local",
            state: "verifying",
            progressPct: 0,
            downloadedBytes: 0,
            totalBytes: 0,
            error: "",
          }
        : null;

    return {
      embedding: embedding as ModelDownloadTask | null,
      reranker: reranker as ModelDownloadTask | null,
    };
  }

  return {
    async ensureRequiredModels() {
      updateStatus((current) => ({
        ...current,
        phase: "verifying",
        lastStartedAt: new Date().toISOString(),
        tasks: buildTasks(),
      }));
      updateStatus((current) => ({
        ...current,
        phase: "completed",
        lastFinishedAt: new Date().toISOString(),
      }));
    },
    async getLocalEmbeddingExtractor(): Promise<LocalEmbeddingExtractor> {
      throw new Error("Not implemented");
    },
    async getLocalRerankerRuntime(): Promise<LocalRerankerRuntime> {
      throw new Error("Not implemented");
    },
    async retryNow() {
      updateStatus((current) => ({
        ...current,
        phase: "running",
        lastStartedAt: new Date().toISOString(),
      }));
      updateStatus((current) => ({
        ...current,
        phase: "completed",
        lastFinishedAt: new Date().toISOString(),
      }));
      return { ok: true };
    },
    async redownloadEmbeddingModel() {
      throw new Error("Not implemented");
    },
    async redownloadRerankerModel() {
      throw new Error("Not implemented");
    },
    getStatus,
  };
}
