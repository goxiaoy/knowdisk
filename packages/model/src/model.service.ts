import { EventEmitter } from "node:events";
import type {
  CreateModelServiceInput,
  LocalEmbeddingExtractor,
  LocalRerankerRuntime,
  ModelDownloadStatus,
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
  _input: CreateModelServiceInput,
): ModelService {
  const emitter = new EventEmitter();
  let status: ModelDownloadStatus = EMPTY_STATUS;

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

  return {
    async ensureRequiredModels() {},
    async getLocalEmbeddingExtractor(): Promise<LocalEmbeddingExtractor> {
      throw new Error("Not implemented");
    },
    async getLocalRerankerRuntime(): Promise<LocalRerankerRuntime> {
      throw new Error("Not implemented");
    },
    async retryNow() {
      throw new Error("Not implemented");
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
