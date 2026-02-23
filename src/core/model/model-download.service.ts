import { EventEmitter } from "node:events";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config/config.types";
import type { LoggerService } from "../logger/logger.service.types";
import type {
  ModelDownloadService,
  ModelDownloadStatus,
  ModelDownloadTask,
} from "./model-download.service.types";

type DownloadRequest = {
  cfg: AppConfig;
  reason: string;
};

type DownloadProgressPayload = {
  progress?: number;
  loaded?: number;
  total?: number;
};

const EMPTY_STATUS: ModelDownloadStatus = {
  phase: "idle",
  triggeredBy: "",
  lastStartedAt: "",
  lastFinishedAt: "",
  progressPct: 0,
  error: "",
  tasks: [],
};

export function createModelDownloadService(
  logger: LoggerService,
): ModelDownloadService {
  const emitter = new EventEmitter();
  let status: ModelDownloadStatus = EMPTY_STATUS;
  let running = false;
  let pending: DownloadRequest | null = null;

  function emit() {
    emitter.emit("change", status);
  }

  function updateStatus(
    updater: (current: ModelDownloadStatus) => ModelDownloadStatus,
  ) {
    status = updater(status);
    emit();
  }

  function buildTasks(cfg: AppConfig): ModelDownloadTask[] {
    const tasks: ModelDownloadTask[] = [];
    if (cfg.embedding.provider === "local") {
      tasks.push({
        id: "embedding-local",
        model: cfg.embedding.local.model,
        provider: "local",
        state: "pending",
        progressPct: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        error: "",
      });
    }
    if (cfg.reranker.enabled && cfg.reranker.provider === "local") {
      tasks.push({
        id: "reranker-local",
        model: cfg.reranker.local.model,
        provider: "local",
        state: "pending",
        progressPct: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        error: "",
      });
    }
    return tasks;
  }

  function updateTask(
    id: ModelDownloadTask["id"],
    updater: (current: ModelDownloadTask) => ModelDownloadTask,
  ) {
    updateStatus((current) => {
      const tasks = current.tasks.map((task) =>
        task.id === id ? updater(task) : task,
      );
      const totalProgress = tasks.length
        ? tasks.reduce((sum, task) => sum + task.progressPct, 0) / tasks.length
        : 100;
      return {
        ...current,
        tasks,
        progressPct: Math.max(0, Math.min(100, Math.round(totalProgress))),
      };
    });
  }

  function onProgress(
    id: ModelDownloadTask["id"],
    payload: DownloadProgressPayload,
  ) {
    const loaded = Number(payload.loaded ?? 0);
    const total = Number(payload.total ?? 0);
    const ratio =
      typeof payload.progress === "number"
        ? payload.progress > 1
          ? payload.progress / 100
          : payload.progress
        : total > 0
          ? loaded / total
          : 0;
    updateTask(id, (task) => ({
      ...task,
      state: "downloading",
      downloadedBytes: Number.isFinite(loaded) ? loaded : task.downloadedBytes,
      totalBytes: Number.isFinite(total) ? total : task.totalBytes,
      progressPct: Math.max(
        0,
        Math.min(100, Math.round(Number.isFinite(ratio) ? ratio * 100 : 0)),
      ),
    }));
  }

  async function preloadEmbeddingModel(cfg: AppConfig) {
    const cacheDir = join(cfg.embedding.local.cacheDir, "provider-local");
    mkdirSync(cacheDir, { recursive: true });
    const transformers = await import("@huggingface/transformers");
    const env = (transformers as unknown as {
      env?: {
        allowRemoteModels?: boolean;
        remoteHost?: string;
        cacheDir?: string;
      };
    }).env;
    if (env) {
      env.allowRemoteModels = true;
      env.remoteHost = cfg.embedding.local.hfEndpoint.replace(/\/+$/, "") + "/";
      env.cacheDir = cacheDir;
    }
    await (
      transformers as unknown as {
        pipeline: (
          task: "feature-extraction",
          model: string,
          opts: { progress_callback: (payload: DownloadProgressPayload) => void },
        ) => Promise<unknown>;
      }
    ).pipeline("feature-extraction", cfg.embedding.local.model, {
      progress_callback: (payload) => onProgress("embedding-local", payload),
    });
  }

  async function preloadRerankerModel(cfg: AppConfig) {
    const cacheDir = join(cfg.reranker.local.cacheDir, "provider-local");
    mkdirSync(cacheDir, { recursive: true });
    const transformers = await import("@huggingface/transformers");
    const env = (transformers as unknown as {
      env?: {
        allowRemoteModels?: boolean;
        remoteHost?: string;
        cacheDir?: string;
      };
    }).env;
    if (env) {
      env.allowRemoteModels = true;
      env.remoteHost = cfg.reranker.local.hfEndpoint.replace(/\/+$/, "") + "/";
      env.cacheDir = cacheDir;
    }
    const tokenizer = await (
      transformers as unknown as {
        AutoTokenizer: {
          from_pretrained: (
            model: string,
            opts: { progress_callback: (payload: DownloadProgressPayload) => void },
          ) => Promise<unknown>;
        };
      }
    ).AutoTokenizer.from_pretrained(cfg.reranker.local.model, {
      progress_callback: (payload) => onProgress("reranker-local", payload),
    });
    void tokenizer;
    await (
      transformers as unknown as {
        AutoModelForSequenceClassification: {
          from_pretrained: (
            model: string,
            opts: {
              quantized: boolean;
              progress_callback: (payload: DownloadProgressPayload) => void;
            },
          ) => Promise<unknown>;
        };
      }
    ).AutoModelForSequenceClassification.from_pretrained(cfg.reranker.local.model, {
      quantized: false,
      progress_callback: (payload) => onProgress("reranker-local", payload),
    });
  }

  function clearModelCache(cacheDir: string, model: string) {
    rmSync(join(cacheDir, "provider-local", model), {
      recursive: true,
      force: true,
    });
  }

  function isCorruptedModelError(error: unknown) {
    const message = String(error ?? "").toLowerCase();
    return (
      message.includes("protobuf parsing failed") ||
      message.includes("onnxruntime") ||
      message.includes("could not locate file") ||
      message.includes("unexpected end of json input")
    );
  }

  async function runTaskWithRecovery(
    taskId: ModelDownloadTask["id"],
    cfg: AppConfig,
    fn: () => Promise<void>,
  ) {
    try {
      await fn();
      updateTask(taskId, (task) => ({
        ...task,
        state: "ready",
        progressPct: 100,
        error: "",
      }));
      return;
    } catch (error) {
      if (!isCorruptedModelError(error)) {
        throw error;
      }
      logger.warn(
        { subsystem: "models", taskId, error: String(error) },
        "Model preload failed, clearing cache and retrying once",
      );
      if (taskId === "embedding-local") {
        clearModelCache(cfg.embedding.local.cacheDir, cfg.embedding.local.model);
      } else {
        clearModelCache(cfg.reranker.local.cacheDir, cfg.reranker.local.model);
      }
      await fn();
      updateTask(taskId, (task) => ({
        ...task,
        state: "ready",
        progressPct: 100,
        error: "",
      }));
    }
  }

  async function processDownload(req: DownloadRequest) {
    const tasks = buildTasks(req.cfg);
    if (tasks.length === 0) {
      updateStatus((current) => ({
        ...current,
        phase: "completed",
        triggeredBy: req.reason,
        lastStartedAt: new Date().toISOString(),
        lastFinishedAt: new Date().toISOString(),
        progressPct: 100,
        error: "",
        tasks: [],
      }));
      return;
    }

    updateStatus(() => ({
      phase: "running",
      triggeredBy: req.reason,
      lastStartedAt: new Date().toISOString(),
      lastFinishedAt: "",
      progressPct: 0,
      error: "",
      tasks,
    }));
    logger.info(
      {
        subsystem: "models",
        reason: req.reason,
        tasks: tasks.map((task) => ({ id: task.id, model: task.model })),
      },
      "Model download started",
    );

    try {
      for (const task of tasks) {
        if (task.id === "embedding-local") {
          await runTaskWithRecovery("embedding-local", req.cfg, () =>
            preloadEmbeddingModel(req.cfg),
          );
          continue;
        }
        if (task.id === "reranker-local") {
          await runTaskWithRecovery("reranker-local", req.cfg, () =>
            preloadRerankerModel(req.cfg),
          );
        }
      }
      updateStatus((current) => ({
        ...current,
        phase: "completed",
        lastFinishedAt: new Date().toISOString(),
        progressPct: 100,
        error: "",
      }));
      logger.info(
        { subsystem: "models", reason: req.reason },
        "Model download completed",
      );
    } catch (error) {
      const message = String(error);
      updateStatus((current) => ({
        ...current,
        phase: "failed",
        lastFinishedAt: new Date().toISOString(),
        error: message,
        tasks: current.tasks.map((task) =>
          task.state === "ready"
            ? task
            : { ...task, state: "failed", error: message },
        ),
      }));
      logger.error(
        { subsystem: "models", reason: req.reason, error: message },
        "Model download failed",
      );
    }
  }

  async function drainQueue() {
    if (running) {
      return;
    }
    running = true;
    try {
      while (pending) {
        const req = pending;
        pending = null;
        await processDownload(req);
      }
    } finally {
      running = false;
    }
  }

  return {
    async ensureRequiredModels(cfg: AppConfig, reason: string) {
      pending = { cfg, reason };
      await drainQueue();
    },
    getStatus() {
      return {
        getSnapshot() {
          return status;
        },
        subscribe(listener) {
          emitter.on("change", listener);
          return () => {
            emitter.off("change", listener);
          };
        },
      };
    },
  };
}
