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

export function selectPreferredRepoFiles(
  siblings: Array<{ rfilename?: string; size?: number }>,
): Array<{ path: string; size: number }> {
  const requiredPaths = new Set([
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "added_tokens.json",
    "vocab.txt",
    "vocab.json",
    "merges.txt",
    "tokenizer.model",
    "sentencepiece.bpe.model",
    "preprocessor_config.json",
  ]);

  return siblings
    .filter(
      (item): item is { rfilename: string; size?: number } =>
        typeof item.rfilename === "string" &&
        item.rfilename.length > 0 &&
        (requiredPaths.has(item.rfilename) ||
          item.rfilename === "onnx/model.onnx" ||
          item.rfilename.startsWith("onnx/model.onnx")),
    )
    .map((item) => ({
      path: item.rfilename,
      size:
        Number.isFinite(item.size) && (item.size ?? 0) > 0
          ? Number(item.size)
          : 0,
    }));
}

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
