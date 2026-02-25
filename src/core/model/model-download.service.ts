import { EventEmitter } from "node:events";
import { createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppConfig, ConfigService } from "../config/config.types";
import type { LoggerService } from "../logger/logger.service.types";
import type {
  LocalEmbeddingExtractor,
  LocalRerankerInputs,
  LocalRerankerRuntime,
  ModelDownloadService,
  ModelDownloadStatus,
  ModelDownloadTask,
  ModelDownloadTasks,
} from "./model-download.service.types";

type DownloadScope = "all" | "embedding-local" | "reranker-local";

type DownloadRequest = {
  cfg: AppConfig;
  reason: string;
  scope: DownloadScope;
};

type QueueEntry = {
  req: DownloadRequest;
  resolve: () => void;
  reject: (error: unknown) => void;
};

type DownloadProgressPayload = {
  loaded: number;
  total: number;
  file: string;
};

type RepoInfoResponse = {
  siblings?: Array<{ rfilename?: string; size?: number }>;
};

type LocalTaskSpec = {
  id: "embedding-local" | "reranker-local";
  model: string;
  provider: "local";
  hfEndpoint: string;
  cacheDir: string;
  kind: "embedding" | "reranker";
};

type RepoFile = {
  path: string;
  size: number;
};

class ModelLoadError extends Error {
  constructor(
    readonly spec: LocalTaskSpec,
    readonly stage:
      | "verify_embedding"
      | "verify_reranker"
      | "load_embedding_runtime"
      | "load_reranker_runtime",
    cause: unknown,
  ) {
    const causeMessage = String(cause);
    super(
      `[${spec.id}] ${spec.kind} model load failed (${spec.model}) at ${stage}: ${causeMessage}`,
    );
    this.name = "ModelLoadError";
  }
}

type OpenedWriteStream = ReturnType<typeof createWriteStream>;
const MODEL_FILE_CONCURRENCY = 4;
const MODEL_RETRY_BACKOFF_MS = [3000, 10000, 30000];
const MODEL_RETRY_MAX_ATTEMPTS = MODEL_RETRY_BACKOFF_MS.length;

export function resolveRangeNotSatisfiableStrategy(
  startOffset: number,
  remoteTotalBytes: number,
): "promote_partial" | "restart" {
  if (remoteTotalBytes > 0 && startOffset === remoteTotalBytes) {
    return "promote_partial";
  }
  return "restart";
}

export function isModelParseErrorMessage(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("protobuf parsing failed") ||
    text.includes("invalid protobuf")
  );
}

const EMPTY_STATUS: ModelDownloadStatus = {
  phase: "idle",
  triggeredBy: "",
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

export function createModelDownloadService(
  logger: LoggerService,
  configService: ConfigService,
): ModelDownloadService {
  const emitter = new EventEmitter();
  let status: ModelDownloadStatus = EMPTY_STATUS;
  const queue: QueueEntry[] = [];
  let drainPromise: Promise<void> | null = null;
  const ensureGuards = new Map<string, Promise<void>>();
  const taskFileStats = new Map<
    ModelDownloadTask["id"],
    Map<string, { loaded: number; total: number }>
  >();
  const readyGuards = new Map<string, Promise<void>>();
  const embeddingRuntimeGuards = new Map<
    string,
    Promise<LocalEmbeddingExtractor>
  >();
  const rerankerRuntimeGuards = new Map<
    string,
    Promise<LocalRerankerRuntime>
  >();
  const embeddingAcquireGuards = new Map<
    string,
    Promise<LocalEmbeddingExtractor>
  >();
  const rerankerAcquireGuards = new Map<
    string,
    Promise<LocalRerankerRuntime>
  >();
  let verifyChain: Promise<void> = Promise.resolve();
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFailedRequest: DownloadRequest | null = null;

  function runModelVerifySerial<T>(work: () => Promise<T>): Promise<T> {
    const run = verifyChain.then(work, work);
    verifyChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function emit() {
    emitter.emit("change", status);
  }

  function updateStatus(
    updater: (current: ModelDownloadStatus) => ModelDownloadStatus,
  ) {
    status = updater(status);
    emit();
  }

  function clearRetryTimer() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleAutoRetry(req: DownloadRequest) {
    const nextAttempt = status.retry.attempt + 1;
    if (nextAttempt > MODEL_RETRY_MAX_ATTEMPTS) {
      updateStatus((current) => ({
        ...current,
        retry: {
          ...current.retry,
          attempt: nextAttempt,
          nextRetryAt: "",
          exhausted: true,
        },
      }));
      void cleanupPartFilesForRequest(req, logger);
      return;
    }
    const delayMs =
      MODEL_RETRY_BACKOFF_MS[
        Math.min(nextAttempt - 1, MODEL_RETRY_BACKOFF_MS.length - 1)
      ]!;
    const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
    updateStatus((current) => ({
      ...current,
      retry: {
        ...current.retry,
        attempt: nextAttempt,
        nextRetryAt,
        exhausted: false,
      },
    }));
    clearRetryTimer();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void enqueueAndWait({
        cfg: req.cfg,
        scope: req.scope,
        reason: "auto_retry",
      }).catch(() => {});
    }, delayMs);
  }

  function normalizeHost(hfEndpoint: string) {
    return hfEndpoint.replace(/\/+$/, "");
  }

  function toModelRoot(cacheDir: string, model: string) {
    return join(cacheDir, model);
  }

  async function clearSpecModelCache(spec: LocalTaskSpec) {
    const modelRoot = toModelRoot(spec.cacheDir, spec.model);
    await rm(modelRoot, {
      recursive: true,
      force: true,
    });
    taskFileStats.delete(spec.id);
    const key = guardKey(spec);
    readyGuards.delete(key);
    embeddingRuntimeGuards.delete(key);
    rerankerRuntimeGuards.delete(key);
    embeddingAcquireGuards.delete(key);
    rerankerAcquireGuards.delete(key);
  }

  function getLocalModelCacheDir(
    cfg: AppConfig,
    kind: "embedding" | "reranker",
  ) {
    return join(cfg.model.cacheDir, kind);
  }

  function buildSpecs(cfg: AppConfig, scope: DownloadScope): LocalTaskSpec[] {
    const specs: LocalTaskSpec[] = [];
    if (
      (scope === "all" || scope === "embedding-local") &&
      cfg.embedding.provider === "local"
    ) {
      specs.push({
        id: "embedding-local",
        model: cfg.embedding.local.model,
        provider: "local",
        hfEndpoint: cfg.model.hfEndpoint,
        cacheDir: getLocalModelCacheDir(cfg, "embedding"),
        kind: "embedding",
      });
    }
    if (
      (scope === "all" || scope === "reranker-local") &&
      cfg.reranker.enabled &&
      cfg.reranker.provider === "local"
    ) {
      specs.push({
        id: "reranker-local",
        model: cfg.reranker.local.model,
        provider: "local",
        hfEndpoint: cfg.model.hfEndpoint,
        cacheDir: getLocalModelCacheDir(cfg, "reranker"),
        kind: "reranker",
      });
    }
    return specs;
  }

  function pickSpec(cfg: AppConfig, id: LocalTaskSpec["id"]): LocalTaskSpec {
    const scope: DownloadScope =
      id === "embedding-local" ? "embedding-local" : "reranker-local";
    const specs = buildSpecs(cfg, scope);
    const found = specs.find((spec) => spec.id === id);
    if (!found) {
      throw new Error(`Local model spec not enabled for ${id}`);
    }
    return found;
  }

  function makeTaskFromSpec(spec: LocalTaskSpec): ModelDownloadTask {
    return {
      id: spec.id,
      model: spec.model,
      provider: spec.provider,
      state: "verifying",
      progressPct: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      error: "",
    };
  }

  function buildTasksFromSpecs(specs: LocalTaskSpec[]): ModelDownloadTasks {
    const embeddingSpec = specs.find((spec) => spec.id === "embedding-local") ?? null;
    const rerankerSpec = specs.find((spec) => spec.id === "reranker-local") ?? null;
    return {
      embedding: embeddingSpec ? makeTaskFromSpec(embeddingSpec) : null,
      reranker: rerankerSpec ? makeTaskFromSpec(rerankerSpec) : null,
    };
  }

  function taskStructToList(tasks: ModelDownloadTasks): ModelDownloadTask[] {
    const list: ModelDownloadTask[] = [];
    if (tasks.embedding) {
      list.push(tasks.embedding);
    }
    if (tasks.reranker) {
      list.push(tasks.reranker);
    }
    return list;
  }

  function updateTask(
    id: ModelDownloadTask["id"],
    updater: (current: ModelDownloadTask) => ModelDownloadTask,
  ) {
    updateStatus((current) => {
      const nextTasks: ModelDownloadTasks = {
        embedding:
          current.tasks.embedding && current.tasks.embedding.id === id
            ? updater(current.tasks.embedding)
            : current.tasks.embedding,
        reranker:
          current.tasks.reranker && current.tasks.reranker.id === id
            ? updater(current.tasks.reranker)
            : current.tasks.reranker,
      };
      const tasks = taskStructToList(nextTasks);
      const weightedByBytes = computeWeightedProgressByBytes(tasks);
      const fallbackByTaskProgress = tasks.length
        ? tasks.reduce((sum, task) => sum + task.progressPct, 0) / tasks.length
        : 100;
      const fallbackByCompletion = computeProgressByCompletion(tasks);
      let nextProgress =
        weightedByBytes ??
        (fallbackByCompletion > 0
          ? fallbackByCompletion
          : fallbackByTaskProgress);
      if (weightedByBytes !== null) {
        const hasUnknownUnfinished = tasks.some(
          (task) =>
            task.totalBytes <= 0 &&
            task.state !== "ready" &&
            task.state !== "failed" &&
            task.state !== "skipped",
        );
        if (hasUnknownUnfinished) {
          nextProgress = Math.min(nextProgress, fallbackByTaskProgress);
        }
      }
      const allFinished = tasks.every(
        (task) =>
          task.state === "ready" ||
          task.state === "failed" ||
          task.state === "skipped",
      );
      if (!allFinished && nextProgress >= 100) {
        nextProgress = 99.9;
      }
      return {
        ...current,
        tasks: nextTasks,
        progressPct: Math.max(current.progressPct, toProgressPct(nextProgress)),
      };
    });
  }

  function onProgress(
    id: ModelDownloadTask["id"],
    payload: DownloadProgressPayload,
  ) {
    const loaded = Math.max(0, payload.loaded);
    const total = Math.max(0, payload.total);
    const statsByFile =
      taskFileStats.get(id) ??
      new Map<string, { loaded: number; total: number }>();
    taskFileStats.set(id, statsByFile);
    const prev = statsByFile.get(payload.file);
    statsByFile.set(payload.file, {
      loaded: Math.max(prev?.loaded ?? 0, loaded),
      total: Math.max(prev?.total ?? 0, total),
    });
    const cumulative = computeCumulativeBytes(statsByFile);
    const bytesRatio =
      cumulative.totalBytes > 0
        ? cumulative.downloadedBytes / cumulative.totalBytes
        : 0;

    updateTask(id, (task) => ({
      ...task,
      state: "downloading",
      downloadedBytes: Math.max(
        task.downloadedBytes,
        cumulative.downloadedBytes,
      ),
      totalBytes: Math.max(task.totalBytes, cumulative.totalBytes),
      progressPct: Math.max(task.progressPct, toProgressPct(bytesRatio * 100)),
    }));
  }

  function syncTaskProgressFromStats(id: ModelDownloadTask["id"]) {
    const statsByFile = taskFileStats.get(id);
    if (!statsByFile) {
      return;
    }
    const cumulative = computeCumulativeBytes(statsByFile);
    const ratio =
      cumulative.totalBytes > 0
        ? cumulative.downloadedBytes / cumulative.totalBytes
        : 0;
    updateTask(id, (task) => ({
      ...task,
      downloadedBytes: Math.max(
        task.downloadedBytes,
        cumulative.downloadedBytes,
      ),
      totalBytes: Math.max(task.totalBytes, cumulative.totalBytes),
      progressPct: Math.max(task.progressPct, toProgressPct(ratio * 100)),
      state:
        task.state === "ready" || task.state === "failed"
          ? task.state
          : "downloading",
    }));
  }

  function isRetryableModelError(error: unknown) {
    return !String(error ?? "").toLowerCase().includes("unsupported model type");
  }

  async function fetchRepoFiles(spec: LocalTaskSpec): Promise<RepoFile[]> {
    const apiUrl = `${normalizeHost(spec.hfEndpoint)}/api/models/${spec.model}`;
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to list model files: ${response.status} ${response.statusText}`,
      );
    }
    const payload = (await response.json()) as RepoInfoResponse;
    const files = selectPreferredRepoFiles(payload.siblings ?? []);
    if (files.length === 0) {
      throw new Error(`Model file list is empty for ${spec.model}`);
    }
    if (!files.some((file) => file.path === "onnx/model.onnx")) {
      throw new Error(`onnx/model.onnx not found for ${spec.model}`);
    }
    return files;
  }

  async function fileExists(path: string) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  function parseContentRangeTotal(value: string | null) {
    if (!value) {
      return null;
    }
    const match = /bytes\s+\d+-\d+\/(\d+)/i.exec(value);
    if (!match) {
      return null;
    }
    const total = Number(match[1]);
    return Number.isFinite(total) ? total : null;
  }

  async function downloadOneFileWithResume(
    spec: LocalTaskSpec,
    file: string,
    expectedSize: number,
    onFileProgress: (payload: DownloadProgressPayload) => void,
  ) {
    const baseUrl = buildModelFileUrl(spec, file);
    const modelRoot = toModelRoot(spec.cacheDir, spec.model);
    const finalPath = join(modelRoot, file);
    const partPath = `${finalPath}.part`;
    await mkdir(dirname(finalPath), { recursive: true });

    if (await fileExists(finalPath)) {
      const done = await stat(finalPath);
      if (expectedSize > 0 && done.size !== expectedSize) {
        logger.warn(
          {
            subsystem: "models",
            taskId: spec.id,
            model: spec.model,
            file,
            actualSize: done.size,
            expectedSize,
          },
          "existing model file size mismatch, deleting and redownloading",
        );
        await rm(finalPath, { force: true });
      } else {
        onFileProgress({ file, loaded: done.size, total: done.size });
        return;
      }
    }
    logger.debug(
      {
        subsystem: "models",
        taskId: spec.id,
        model: spec.model,
        file,
      },
      "model file download started",
    );

    let startOffset = 0;
    if (await fileExists(partPath)) {
      const partial = await stat(partPath);
      startOffset = partial.size;
      if (expectedSize > 0 && startOffset > expectedSize) {
        logger.warn(
          {
            subsystem: "models",
            taskId: spec.id,
            model: spec.model,
            file,
            partialSize: startOffset,
            expectedSize,
          },
          "partial file larger than expected size, truncating and restarting",
        );
        await truncate(partPath, 0);
        startOffset = 0;
      }
      logger.debug(
        {
          subsystem: "models",
          taskId: spec.id,
          model: spec.model,
          file,
          resumeOffset: startOffset,
        },
        "model file resume from partial",
      );
    }

    let response = await fetch(baseUrl, {
      headers: startOffset > 0 ? { Range: `bytes=${startOffset}-` } : undefined,
    });

    if (startOffset > 0 && response.status === 200) {
      await truncate(partPath, 0);
      startOffset = 0;
      response = await fetch(baseUrl);
    }

    if (startOffset > 0 && response.status === 416) {
      const remoteTotal = await probeRemoteFileSize(baseUrl, {
        taskId: spec.id,
        model: spec.model,
        file,
      });
      const strategy = resolveRangeNotSatisfiableStrategy(
        startOffset,
        remoteTotal,
      );
      logger.debug(
        {
          subsystem: "models",
          taskId: spec.id,
          model: spec.model,
          file,
          startOffset,
          remoteTotal,
          strategy,
        },
        "range request not satisfiable",
      );
      if (
        strategy === "promote_partial" &&
        (expectedSize <= 0 || expectedSize === startOffset)
      ) {
        await finalizeDownloadedFile(partPath, finalPath);
        onFileProgress({
          file,
          loaded: remoteTotal,
          total: remoteTotal,
        });
        logger.debug(
          {
            subsystem: "models",
            taskId: spec.id,
            model: spec.model,
            file,
            bytes: remoteTotal,
          },
          "partial file promoted after 416",
        );
        return;
      }
      await truncate(partPath, 0);
      startOffset = 0;
      response = await fetch(baseUrl);
    }

    if (!(response.ok || response.status === 206)) {
      throw new Error(
        `Failed to download ${file}: ${response.status} ${response.statusText}`,
      );
    }

    if (!response.body) {
      throw new Error(`Failed to download ${file}: empty response body`);
    }
    if (file.endsWith(".onnx")) {
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (contentType.includes("text/html")) {
        throw new Error(`Failed to download ${file}: unexpected content-type ${contentType}`);
      }
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    const parsedTotal = parseContentRangeTotal(
      response.headers.get("content-range"),
    );
    const totalBytes =
      parsedTotal ??
      (contentLength > 0 ? startOffset + contentLength : expectedSize > 0 ? expectedSize : 0);
    onFileProgress({ file, loaded: startOffset, total: totalBytes });
    logger.debug(
      {
        subsystem: "models",
        taskId: spec.id,
        model: spec.model,
        file,
        totalBytes,
        startOffset,
        httpStatus: response.status,
      },
      "model file response accepted",
    );

    const writer = await openPartWriterWithRetry(
      partPath,
      startOffset > 0 ? "a" : "w",
    );
    let loadedBytes = startOffset;
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!value || value.length === 0) {
          continue;
        }
        loadedBytes += value.length;
        await new Promise<void>((resolve, reject) => {
          writer.write(Buffer.from(value), (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
        onFileProgress({ file, loaded: loadedBytes, total: totalBytes });
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        writer.end((error: Error | null | undefined) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }

    if (totalBytes > 0 && loadedBytes < totalBytes) {
      throw new Error(
        `Downloaded file is incomplete: ${file} (${loadedBytes}/${totalBytes})`,
      );
    }

    await finalizeDownloadedFile(partPath, finalPath);
    const done = await stat(finalPath);
    if (expectedSize > 0 && done.size !== expectedSize) {
      await rm(finalPath, { force: true });
      throw new Error(
        `Downloaded file size mismatch: ${file} (${done.size}/${expectedSize})`,
      );
    }
    onFileProgress({
      file,
      loaded: done.size,
      total: expectedSize > 0 ? expectedSize : totalBytes > 0 ? totalBytes : done.size,
    });
    logger.debug(
      {
        subsystem: "models",
        taskId: spec.id,
        model: spec.model,
        file,
        bytes: done.size,
      },
      "model file download completed",
    );
  }

  async function finalizeDownloadedFile(partPath: string, finalPath: string) {
    try {
      await rename(partPath, finalPath);
      return;
    } catch (error) {
      if (!isEnoent(error)) {
        throw error;
      }
      // Another concurrent flow may have already promoted .part to final.
      if (await fileExists(finalPath)) {
        return;
      }
      throw error;
    }
  }

  async function probeRemoteFileSize(
    url: string,
    meta: { taskId: string; model: string; file: string },
  ) {
    try {
      const head = await fetch(url, { method: "HEAD" });
      if (head.ok) {
        const len = Number(head.headers.get("content-length") ?? "0");
        if (Number.isFinite(len) && len > 0) {
          logger.debug(
            {
              subsystem: "models",
              taskId: meta.taskId,
              model: meta.model,
              file: meta.file,
              method: "HEAD",
              bytes: len,
            },
            "model file size probed",
          );
          return len;
        }
      }
    } catch {
      logger.debug(
        {
          subsystem: "models",
          taskId: meta.taskId,
          model: meta.model,
          file: meta.file,
          method: "HEAD",
        },
        "model file size probe failed, fallback to range",
      );
    }
    try {
      const ranged = await fetch(url, { headers: { Range: "bytes=0-0" } });
      const total = parseContentRangeTotal(ranged.headers.get("content-range"));
      if (total && total > 0) {
        logger.debug(
          {
            subsystem: "models",
            taskId: meta.taskId,
            model: meta.model,
            file: meta.file,
            method: "RANGE",
            bytes: total,
          },
          "model file size probed",
        );
        return total;
      }
      const len = Number(ranged.headers.get("content-length") ?? "0");
      if (Number.isFinite(len) && len > 0) {
        logger.debug(
          {
            subsystem: "models",
            taskId: meta.taskId,
            model: meta.model,
            file: meta.file,
            method: "RANGE",
            bytes: len,
          },
          "model file size probed",
        );
        return len;
      }
    } catch {
      logger.debug(
        {
          subsystem: "models",
          taskId: meta.taskId,
          model: meta.model,
          file: meta.file,
          method: "RANGE",
        },
        "model file size probe failed",
      );
    }
    logger.debug(
      {
        subsystem: "models",
        taskId: meta.taskId,
        model: meta.model,
        file: meta.file,
      },
      "model file size unknown",
    );
    return 0;
  }

  async function initializeTaskFileStats(
    spec: LocalTaskSpec,
    files: RepoFile[],
  ) {
    const statsByFile =
      taskFileStats.get(spec.id) ??
      new Map<string, { loaded: number; total: number }>();
    taskFileStats.set(spec.id, statsByFile);
    const modelRoot = toModelRoot(spec.cacheDir, spec.model);

    await Promise.all(
      files.map(async (file) => {
        const finalPath = join(modelRoot, file.path);
        const partPath = `${finalPath}.part`;
        if (await fileExists(finalPath)) {
          const done = await stat(finalPath);
          statsByFile.set(file.path, { loaded: done.size, total: done.size });
          return;
        }
        let loaded = 0;
        if (await fileExists(partPath)) {
          const partial = await stat(partPath);
          loaded = partial.size;
        }
        const fileUrl = buildModelFileUrl(spec, file.path);
        const probed =
          file.size > 0
            ? file.size
            : await probeRemoteFileSize(fileUrl, {
                taskId: spec.id,
                model: spec.model,
                file: file.path,
              });
        const total = Math.max(loaded, probed);
        statsByFile.set(file.path, { loaded, total });
      }),
    );
    syncTaskProgressFromStats(spec.id);
  }

  async function openPartWriterWithRetry(partPath: string, flags: "a" | "w") {
    try {
      return await openPartWriter(partPath, flags);
    } catch (error) {
      if (!isEnoent(error)) {
        throw error;
      }
      await mkdir(dirname(partPath), { recursive: true });
      return openPartWriter(partPath, flags);
    }
  }

  async function openPartWriter(
    partPath: string,
    flags: "a" | "w",
  ): Promise<OpenedWriteStream> {
    const writer = createWriteStream(partPath, { flags });
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        writer.off("error", onError);
        resolve();
      };
      const onError = (error: unknown) => {
        writer.off("open", onOpen);
        reject(error);
      };
      writer.once("open", onOpen);
      writer.once("error", onError);
    });
    return writer;
  }

  async function writeManifest(spec: LocalTaskSpec, files: string[]) {
    const modelRoot = toModelRoot(spec.cacheDir, spec.model);
    const manifestPath = join(modelRoot, ".knowdisk-manifest.json");
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          model: spec.model,
          hfEndpoint: normalizeHost(spec.hfEndpoint),
          downloadedAt: new Date().toISOString(),
          files,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  async function configureTransformersEnv(spec: LocalTaskSpec) {
    const transformers = await import("@huggingface/transformers");
    const env = (
      transformers as unknown as {
        env?: {
          allowRemoteModels?: boolean;
          remoteHost?: string;
          cacheDir?: string;
        };
      }
    ).env;
    if (env) {
      env.allowRemoteModels = false;
      env.remoteHost = normalizeHost(spec.hfEndpoint) + "/";
      env.cacheDir = spec.cacheDir;
    }
  }

  async function loadLocalEmbeddingExtractor(
    spec: LocalTaskSpec,
  ): Promise<LocalEmbeddingExtractor> {
    const transformers = await import("@huggingface/transformers");
    return (
      transformers as unknown as {
        pipeline: (
          task: "feature-extraction",
          model: string,
          opts?: { local_files_only?: boolean },
        ) => Promise<LocalEmbeddingExtractor>;
      }
    ).pipeline("feature-extraction", spec.model, {
      local_files_only: true,
    });
  }

  async function loadLocalRerankerRuntime(
    spec: LocalTaskSpec,
  ): Promise<LocalRerankerRuntime> {
    const transformers = await import("@huggingface/transformers");

    const tokenizer = await (
      transformers as unknown as {
        AutoTokenizer: {
          from_pretrained: (
            model: string,
            opts?: { local_files_only?: boolean },
          ) => Promise<{
            (
              texts: string[],
              opts: {
                text_pair: string[];
                padding: boolean;
                truncation: boolean;
              },
            ): unknown;
          }>;
        };
      }
    ).AutoTokenizer.from_pretrained(spec.model, {
      local_files_only: true,
    });

    const model = await (
      transformers as unknown as {
        AutoModelForSequenceClassification: {
          from_pretrained: (
            model: string,
            opts: { quantized: boolean; local_files_only?: boolean },
          ) => Promise<{
            (
              inputs: unknown,
            ): Promise<{ logits?: { data?: ArrayLike<number> } }>;
          }>;
        };
      }
    ).AutoModelForSequenceClassification.from_pretrained(spec.model, {
      quantized: false,
      local_files_only: true,
    });

    return {
      async tokenizePairs(query: string, docs: string[]) {
        const queries = Array(docs.length).fill(query);
        return tokenizer(queries, {
          text_pair: docs,
          padding: true,
          truncation: true,
        });
      },
      async score(inputs: LocalRerankerInputs) {
        const outputs = await model(inputs);
        if (!outputs?.logits?.data) {
          return [];
        }
        return Array.from(outputs.logits.data);
      },
    };
  }

  async function verifyModelIntegrity(spec: LocalTaskSpec) {
    await runModelVerifySerial(async () => {
      if (spec.kind === "embedding") {
        try {
          await configureTransformersEnv(spec);
          await loadLocalEmbeddingExtractor(spec);
        } catch (error) {
          throw new ModelLoadError(spec, "verify_embedding", error);
        }
        return;
      }
      try {
        await configureTransformersEnv(spec);
        await loadLocalRerankerRuntime(spec);
      } catch (error) {
        throw new ModelLoadError(spec, "verify_reranker", error);
      }
    });
  }

  function guardKey(spec: LocalTaskSpec) {
    return `${spec.id}::${spec.model}::${normalizeHost(spec.hfEndpoint)}::${spec.cacheDir}`;
  }

  async function ensureSpecReadyWithRecovery(
    spec: LocalTaskSpec,
    reason: string,
  ) {
    const key = guardKey(spec);
    const existing = readyGuards.get(key);
    if (existing) {
      return existing;
    }
    const promise = (async () => {
      try {
        await runSpecDownload(spec, reason);
      } finally {
        readyGuards.delete(key);
      }
    })();
    readyGuards.set(key, promise);
    return promise;
  }

  async function isSpecReady(spec: LocalTaskSpec) {
    try {
      await verifyModelIntegrity(spec);
      return true;
    } catch (error) {
      logger.warn(
        {
          subsystem: "models",
          taskId: spec.id,
          model: spec.model,
          kind: spec.kind,
          error: String(error),
        },
        "Model verify failed",
      );
      return false;
    }
  }

  async function runSpecDownload(spec: LocalTaskSpec, _reason: string) {
    logger.info(
      { subsystem: "models", taskId: spec.id, model: spec.model, kind: spec.kind },
      "Model task download started",
    );
    const files = await fetchRepoFiles(spec);
    await initializeTaskFileStats(spec, files);
    await runWithConcurrency(files, MODEL_FILE_CONCURRENCY, async (file) => {
      await downloadOneFileWithResume(spec, file.path, file.size, (payload) => {
        onProgress(spec.id, payload);
      });
    });
    await writeManifest(
      spec,
      files.map((file) => file.path),
    );
    await verifyModelIntegrity(spec);
    updateTask(spec.id, (task) => ({
      ...task,
      state: "ready",
      progressPct: 100,
      error: "",
    }));
    logger.info(
      {
        subsystem: "models",
        taskId: spec.id,
        model: spec.model,
        kind: spec.kind,
        downloadedFiles: files.length,
      },
      "Model task download completed",
    );
  }

  async function processDownload(req: DownloadRequest) {
    const runId = `ensure-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const specs = buildSpecs(req.cfg, req.scope);
    const tasks = buildTasksFromSpecs(specs);
    taskFileStats.clear();

    if (!tasks.embedding && !tasks.reranker) {
      updateStatus((current) => ({
        ...current,
        phase: "completed",
        triggeredBy: req.reason,
        lastStartedAt: new Date().toISOString(),
        lastFinishedAt: new Date().toISOString(),
        progressPct: 100,
        error: "",
        tasks: {
          embedding: null,
          reranker: null,
        },
        retry: {
          ...current.retry,
          attempt: 0,
          nextRetryAt: "",
          exhausted: false,
        },
      }));
      logger.info(
        { subsystem: "models", runId, reason: req.reason, scope: req.scope },
        "Model ensure skipped: no local model tasks",
      );
      return;
    }

    const taskList = taskStructToList(tasks);

    updateStatus((current) => ({
      phase: "verifying",
      triggeredBy: req.reason,
      lastStartedAt: new Date().toISOString(),
      lastFinishedAt: "",
      progressPct: 0,
      error: "",
      tasks,
      retry: {
        ...current.retry,
        maxAttempts: MODEL_RETRY_MAX_ATTEMPTS,
        backoffMs: [...MODEL_RETRY_BACKOFF_MS],
      },
    }));
    logger.info(
      {
        subsystem: "models",
        runId,
        reason: req.reason,
        scope: req.scope,
        tasks: taskList.map((task) => ({ id: task.id, model: task.model })),
      },
      "Model ensure started",
    );

    try {
      const readiness = await Promise.all(
        specs.map((spec) => isSpecReady(spec)),
      );
      const missing: LocalTaskSpec[] = [];
      for (let i = 0; i < specs.length; i += 1) {
        const spec = specs[i]!;
        if (readiness[i]) {
          updateTask(spec.id, (task) => ({
            ...task,
            state: "ready",
            progressPct: 100,
            error: "",
          }));
          logger.debug(
            { subsystem: "models", runId, taskId: spec.id, model: spec.model },
            "Model verify passed; download skipped",
          );
          continue;
        }
        updateTask(spec.id, (task) => ({
          ...task,
          state: "pending",
          progressPct: 0,
          error: "",
        }));
        logger.info(
          { subsystem: "models", runId, taskId: spec.id, model: spec.model },
          "Model verify failed; download required",
        );
        missing.push(spec);
      }

      if (missing.length > 0) {
        updateStatus((current) => ({
          ...current,
          phase: "running",
        }));
        logger.info(
          {
            subsystem: "models",
            runId,
            reason: req.reason,
            scope: req.scope,
            pendingTasks: missing.map((spec) => ({ id: spec.id, model: spec.model })),
          },
          "Model download phase started",
        );
        for (const spec of missing) {
          await ensureSpecReadyWithRecovery(spec, req.reason);
        }
      }
      updateStatus((current) => ({
        ...current,
        phase: "completed",
        lastFinishedAt: new Date().toISOString(),
        progressPct: 100,
        error: "",
        retry: {
          ...current.retry,
          attempt: 0,
          nextRetryAt: "",
          exhausted: false,
        },
      }));
      clearRetryTimer();
      lastFailedRequest = null;
      logger.info(
        {
          subsystem: "models",
          runId,
          reason: req.reason,
          scope: req.scope,
          verifiedTasks: specs.length - missing.length,
          downloadedTasks: missing.length,
          totalTasks: specs.length,
        },
        "Model ensure completed",
      );
    } catch (error) {
      const message = String(error);
      updateStatus((current) => ({
        ...current,
        phase: "failed",
        lastFinishedAt: new Date().toISOString(),
        tasks: {
          embedding:
            current.tasks.embedding && current.tasks.embedding.state !== "ready"
              ? { ...current.tasks.embedding, state: "failed", error: message }
              : current.tasks.embedding,
          reranker:
            current.tasks.reranker && current.tasks.reranker.state !== "ready"
              ? { ...current.tasks.reranker, state: "failed", error: message }
              : current.tasks.reranker,
        },
      }));
      lastFailedRequest = req;
      if (isRetryableModelError(error)) {
        scheduleAutoRetry(req);
      } else {
        updateStatus((current) => ({
          ...current,
          retry: {
            ...current.retry,
            nextRetryAt: "",
            exhausted: true,
          },
        }));
      }
      const loadError = error instanceof ModelLoadError ? error : null;
      logger.error(
        {
          subsystem: "models",
          runId,
          reason: req.reason,
          scope: req.scope,
          error: message,
          taskId: loadError?.spec.id ?? "",
          modelKind: loadError?.spec.kind ?? "",
          modelName: loadError?.spec.model ?? "",
          stage: loadError?.stage ?? "",
        },
        "Model ensure failed",
      );
      throw error;
    }
  }

  function drainQueue() {
    if (drainPromise) {
      return drainPromise;
    }
    drainPromise = (async () => {
      while (queue.length > 0) {
        const entry = queue.shift()!;
        try {
          await processDownload(entry.req);
          entry.resolve();
        } catch (error) {
          entry.reject(error);
        }
      }
    })().finally(() => {
      drainPromise = null;
    });
    return drainPromise;
  }

  async function enqueueAndWait(req: DownloadRequest) {
    const key = buildEnsureKey(req);
    const existing = ensureGuards.get(key);
    if (existing) {
      return existing;
    }
    const pending = new Promise<void>((resolve, reject) => {
      queue.push({ req, resolve, reject });
      void drainQueue();
    });
    ensureGuards.set(key, pending);
    try {
      await pending;
    } finally {
      const latest = ensureGuards.get(key);
      if (latest === pending) {
        ensureGuards.delete(key);
      }
    }
  }

  async function acquireEmbeddingExtractor(
    cfg: AppConfig,
    reason: string,
  ): Promise<LocalEmbeddingExtractor> {
    const spec = pickSpec(cfg, "embedding-local");
    const key = guardKey(spec);
    const existing = embeddingRuntimeGuards.get(key);
    if (existing) {
      return existing;
    }
    const acquiring = embeddingAcquireGuards.get(key);
    if (acquiring) {
      return acquiring;
    }
    const next = (async () => {
      await enqueueAndWait({ cfg, reason, scope: "embedding-local" });
      const afterQueue = embeddingRuntimeGuards.get(key);
      if (afterQueue) {
        return afterQueue;
      }
      await configureTransformersEnv(spec);
      const created = loadLocalEmbeddingExtractor(spec).catch((error) => {
        throw new ModelLoadError(spec, "load_embedding_runtime", error);
      });
      embeddingRuntimeGuards.set(key, created);
      return created;
    })().finally(() => {
      embeddingAcquireGuards.delete(key);
    });
    embeddingAcquireGuards.set(key, next);
    return next;
  }

  async function acquireRerankerRuntime(
    cfg: AppConfig,
    reason: string,
  ): Promise<LocalRerankerRuntime> {
    const spec = pickSpec(cfg, "reranker-local");
    const key = guardKey(spec);
    const existing = rerankerRuntimeGuards.get(key);
    if (existing) {
      return existing;
    }
    const acquiring = rerankerAcquireGuards.get(key);
    if (acquiring) {
      return acquiring;
    }
    const next = (async () => {
      // Reranker must wait until embedding is settled first.
      await enqueueAndWait({ cfg, reason, scope: "all" });
      const afterQueue = rerankerRuntimeGuards.get(key);
      if (afterQueue) {
        return afterQueue;
      }
      await configureTransformersEnv(spec);
      const created = loadLocalRerankerRuntime(spec).catch((error) => {
        throw new ModelLoadError(spec, "load_reranker_runtime", error);
      });
      rerankerRuntimeGuards.set(key, created);
      return created;
    })().finally(() => {
      rerankerAcquireGuards.delete(key);
    });
    rerankerAcquireGuards.set(key, next);
    return next;
  }

  return {
    async ensureRequiredModels() {
      await enqueueAndWait({
        cfg: configService.getConfig(),
        reason: "ensure_required_models",
        scope: "all",
      });
    },
    async getLocalEmbeddingExtractor() {
      return acquireEmbeddingExtractor(
        configService.getConfig(),
        "embedding_runtime",
      );
    },
    async getLocalRerankerRuntime() {
      return acquireRerankerRuntime(
        configService.getConfig(),
        "reranker_runtime",
      );
    },
    async retryNow() {
      if (!lastFailedRequest) {
        return { ok: false, reason: "no_failed_request" };
      }
      clearRetryTimer();
      updateStatus((current) => ({
        ...current,
        retry: {
          ...current.retry,
          nextRetryAt: "",
          exhausted: false,
        },
      }));
      try {
        await enqueueAndWait({
          ...lastFailedRequest,
          reason: "manual_retry",
        });
        return { ok: true, reason: "manual_retry_triggered" };
      } catch {
        return { ok: false, reason: "manual_retry_failed" };
      }
    },
    async redownloadModel(taskId) {
      const cfg = configService.getConfig();
      const spec = pickSpec(cfg, taskId);
      try {
        clearRetryTimer();
        await clearSpecModelCache(spec);
        await enqueueAndWait({
          cfg,
          reason: "manual_redownload",
          scope:
            taskId === "embedding-local" ? "embedding-local" : "reranker-local",
        });
        return { ok: true, reason: "manual_redownload_triggered" };
      } catch (error) {
        logger.error(
          {
            subsystem: "models",
            taskId,
            model: spec.model,
            error: String(error),
          },
          "model redownload failed",
        );
        return { ok: false, reason: "manual_redownload_failed" };
      }
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

function buildEnsureKey(req: DownloadRequest) {
  const cfg = req.cfg;
  const payload = {
    scope: req.scope,
    reason: req.reason,
    model: {
      hfEndpoint: cfg.model.hfEndpoint,
      cacheDir: cfg.model.cacheDir,
    },
    embedding: {
      provider: cfg.embedding.provider,
      local:
        cfg.embedding.provider === "local"
          ? {
              model: cfg.embedding.local.model,
              dimension: cfg.embedding.local.dimension,
            }
          : null,
    },
    reranker: {
      enabled: cfg.reranker.enabled,
      provider: cfg.reranker.provider,
      local:
        cfg.reranker.provider === "local"
          ? {
              model: cfg.reranker.local.model,
              topN: cfg.reranker.local.topN,
            }
          : null,
    },
  };
  return JSON.stringify(payload);
}

function computeCumulativeBytes(
  byFile: Map<string, { loaded: number; total: number }>,
) {
  let downloadedBytes = 0;
  let totalBytes = 0;
  for (const stat of byFile.values()) {
    downloadedBytes += stat.loaded;
    totalBytes += stat.total;
  }
  return { downloadedBytes, totalBytes };
}

function computeWeightedProgressByBytes(tasks: ModelDownloadTask[]) {
  const tasksWithTotals = tasks.filter((task) => task.totalBytes > 0);
  if (tasksWithTotals.length === 0) {
    return null;
  }
  const totalBytes = tasksWithTotals.reduce(
    (sum, task) => sum + task.totalBytes,
    0,
  );
  if (totalBytes <= 0) {
    return null;
  }
  const downloadedBytes = tasksWithTotals.reduce(
    (sum, task) => sum + Math.min(task.downloadedBytes, task.totalBytes),
    0,
  );
  return (downloadedBytes / totalBytes) * 100;
}

function computeProgressByCompletion(tasks: ModelDownloadTask[]) {
  if (tasks.length === 0) {
    return 100;
  }
  const finished = tasks.filter((task) => task.state === "ready").length;
  return (finished / tasks.length) * 100;
}

function isEnoent(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  return code === "ENOENT";
}

function encodePathSegment(value: string) {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildModelFileUrl(spec: LocalTaskSpec, file: string) {
  const encodedModel = encodePathSegment(spec.model);
  const encodedFile = encodePathSegment(file);
  return `${normalizeHostUrl(spec.hfEndpoint)}/${encodedModel}/resolve/main/${encodedFile}`;
}

function toProgressPct(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const bounded = Math.max(0, Math.min(100, value));
  return Math.round(bounded * 10) / 10;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  if (items.length === 0) {
    return;
  }
  const size = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  const runners = Array.from({ length: size }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
}

function normalizeHostUrl(hfEndpoint: string) {
  return hfEndpoint.replace(/\/+$/, "");
}

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

async function cleanupPartFilesForRequest(
  req: DownloadRequest,
  logger: LoggerService,
) {
  const roots: string[] = [];
  if (
    (req.scope === "all" || req.scope === "embedding-local") &&
    req.cfg.embedding.provider === "local"
  ) {
    roots.push(
      join(req.cfg.model.cacheDir, "embedding", req.cfg.embedding.local.model),
    );
  }
  if (
    (req.scope === "all" || req.scope === "reranker-local") &&
    req.cfg.reranker.enabled &&
    req.cfg.reranker.provider === "local"
  ) {
    roots.push(
      join(req.cfg.model.cacheDir, "reranker", req.cfg.reranker.local.model),
    );
  }

  for (const root of roots) {
    await removePartFilesRecursively(root, logger);
  }
}

async function removePartFilesRecursively(root: string, logger: LoggerService) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      await removePartFilesRecursively(fullPath, logger);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".part")) {
      await rm(fullPath, { force: true });
      logger.debug(
        { subsystem: "models", path: fullPath },
        "stale model part file removed",
      );
    }
  }
}
