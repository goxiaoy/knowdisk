import { stat } from "node:fs/promises";
import { extname } from "node:path";
import type { ConfigService } from "../config/config.types";
import type { EmbeddingProvider } from "../embedding/embedding.types";
import type {
  FileChange,
  IndexingService,
  IndexingStatus,
} from "./indexing.service.types";
import type { LoggerService } from "../logger/logger.service.types";
import type { VectorRepository } from "../vector/vector.repository.types";
import { createIndexMetadataRepository } from "./metadata/index-metadata.repository";
import type { IndexMetadataRepository } from "./metadata/index-metadata.repository.types";
import { createIndexJobScheduler } from "./jobs/index-job.scheduler";
import { createFileIndexProcessor } from "./processor/file-index.processor";
import { createIndexWorker } from "./worker/index-worker";
import { collectIndexableFiles } from "./scan.files";
import type { ChunkingService } from "./chunker/chunker.service.types";

export function createSourceIndexingService(
  configService: ConfigService,
  embedding: EmbeddingProvider,
  chunking: ChunkingService,
  vector: Pick<VectorRepository, "upsert" | "deleteBySourcePath">,
  logger?: LoggerService,
  opts?: {
    metadata?: IndexMetadataRepository;
    metadataDbPath?: string;
  },
): IndexingService {
  const log = logger?.child({ subsystem: "indexing" }) ?? {
    info: (_obj?: unknown, _msg?: string) => {},
    warn: (_obj?: unknown, _msg?: string) => {},
    error: (_obj?: unknown, _msg?: string) => {},
    debug: (_obj?: unknown, _msg?: string) => {},
  };

  const cfg = configService.getConfig();
  const metadata =
    opts?.metadata ??
    createIndexMetadataRepository({ dbPath: opts?.metadataDbPath ?? ":memory:" });
  const processor = createFileIndexProcessor({
    embedding,
    chunking,
    vector,
    metadata,
  });

  const indexingState: IndexingStatus = {
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

  const listeners = new Set<(status: IndexingStatus) => void>();
  const notify = () => {
    const snapshot: IndexingStatus = {
      run: {
        ...indexingState.run,
        errors: [...indexingState.run.errors],
      },
      scheduler: { ...indexingState.scheduler },
      worker: {
        ...indexingState.worker,
        currentFiles: [...indexingState.worker.currentFiles],
      },
    };
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const worker = createIndexWorker({
    metadata,
    processor,
    concurrency: cfg.indexing.worker.concurrency,
    maxAttempts: cfg.indexing.retry.maxAttempts,
    backoffMs: cfg.indexing.retry.backoffMs,
    onJobStart(path, jobType) {
      indexingState.worker.phase = jobType === "delete" ? "deleting" : "indexing";
      if (!indexingState.worker.currentFiles.includes(path)) {
        indexingState.worker.currentFiles.push(path);
      }
      indexingState.worker.runningWorkers = indexingState.worker.currentFiles.length;
      notify();
    },
    onJobDone(path) {
      if (indexingState.worker.currentFiles.includes(path)) {
        indexingState.worker.currentFiles = indexingState.worker.currentFiles.filter(
          (item) => item !== path,
        );
      }
      indexingState.worker.runningWorkers = indexingState.worker.currentFiles.length;
      indexingState.worker.phase =
        indexingState.worker.runningWorkers > 0
          ? indexingState.worker.phase
          : "idle";
      indexingState.run.indexedFiles += 1;
      notify();
    },
    onJobError(path, _jobType, error) {
      const message = `${path}: ${error}`;
      indexingState.run.errors.push(message);
      log.error({ path, error }, "index job failed");
      indexingState.worker.currentFiles = indexingState.worker.currentFiles.filter(
        (item) => item !== path,
      );
      indexingState.worker.runningWorkers = indexingState.worker.currentFiles.length;
      indexingState.worker.phase = "failed";
      indexingState.worker.lastError = message;
      notify();
    },
  });

  worker.start();

  const scheduler = createIndexJobScheduler(
    {
      enqueueJob(job) {
        metadata.enqueueJob(job);
      },
    },
    { debounceMs: cfg.indexing.watch.debounceMs },
  );

  const statusStore = {
    getSnapshot() {
      return {
        run: {
          ...indexingState.run,
          errors: [...indexingState.run.errors],
        },
        scheduler: { ...indexingState.scheduler },
        worker: {
          ...indexingState.worker,
          currentFiles: [...indexingState.worker.currentFiles],
        },
      };
    },
    subscribe(listener: (status: IndexingStatus) => void) {
      listeners.add(listener);
      listener({
        run: {
          ...indexingState.run,
          errors: [...indexingState.run.errors],
        },
        scheduler: { ...indexingState.scheduler },
        worker: {
          ...indexingState.worker,
          currentFiles: [...indexingState.worker.currentFiles],
        },
      });
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    async runFullRebuild(reason: string) {
      beginRun(reason);
      const repair = await enqueueReconcileJobs(reason);
      await drainWorkerQueue();
      finishRun(reason);
      return {
        indexedFiles: indexingState.run.indexedFiles,
        errors: [...indexingState.run.errors],
        repaired: repair,
      };
    },

    async runIncremental(changes: FileChange[]) {
      beginRun("incremental");
      const now = Date.now();
      const eventAt = now - cfg.indexing.watch.debounceMs - 1;
      for (const change of changes) {
        scheduler.onFsEvent(change.path, normalizeChangeType(change.type), eventAt);
      }
      scheduler.flushDue(now);
      await drainWorkerQueue();
      finishRun("incremental");
      return {
        indexedFiles: indexingState.run.indexedFiles,
        errors: [...indexingState.run.errors],
      };
    },

    async runScheduledReconcile() {
      const repaired = await enqueueReconcileJobs("scheduled_reconcile");
      await drainWorkerQueue();
      indexingState.run.lastReconcileAt = new Date().toISOString();
      notify();
      return { repaired };
    },

    deferSourceDeletion(sourcePath: string) {
      metadata.addSourceTombstone(sourcePath);
      log.info({ sourcePath }, "deferred source deletion recorded");
    },

    cancelDeferredSourceDeletion(sourcePath: string) {
      metadata.removeSourceTombstone(sourcePath);
      log.info({ sourcePath }, "deferred source deletion removed");
    },

    async purgeDeferredSourceDeletions() {
      const sources = metadata.listSourceTombstones();
      if (sources.length === 0) {
        return { removedSources: 0, deletedFiles: 0 };
      }

      beginRun("startup_source_cleanup");
      const now = Date.now();
      const knownFiles = metadata
        .listFiles()
        .filter((file) => file.status !== "deleted");
      let deletedFiles = 0;
      for (const sourcePath of sources) {
        const matches = knownFiles.filter((file) =>
          isSameOrParentPath(sourcePath, file.path),
        );
        for (const file of matches) {
          metadata.enqueueJob({
            jobId: globalThis.crypto.randomUUID(),
            path: file.path,
            jobType: "delete",
            reason: "startup_source_cleanup",
            nextRunAtMs: now,
          });
          indexingState.scheduler.queueDepth += 1;
          deletedFiles += 1;
        }
      }
      await drainWorkerQueue();
      for (const sourcePath of sources) {
        metadata.removeSourceTombstone(sourcePath);
      }
      finishRun("startup_source_cleanup");
      return { removedSources: sources.length, deletedFiles };
    },

    clearAllIndexData() {
      metadata.clearAllIndexData();
      log.info("index metadata cleared");
    },

    getIndexStatus() {
      return statusStore;
    },
  };

  function beginRun(reason: string) {
    indexingState.run.phase = "running";
    indexingState.run.reason = reason;
    indexingState.run.startedAt = new Date().toISOString();
    indexingState.run.finishedAt = "";
    indexingState.run.indexedFiles = 0;
    indexingState.run.errors = [];
    indexingState.scheduler.phase = "idle";
    indexingState.scheduler.queueDepth = 0;
    indexingState.worker.phase = "idle";
    indexingState.worker.runningWorkers = 0;
    indexingState.worker.currentFiles = [];
    indexingState.worker.lastError = "";
    notify();
  }

  function finishRun(reason: string) {
    indexingState.run.phase = "idle";
    indexingState.run.finishedAt = new Date().toISOString();
    indexingState.worker.phase = "idle";
    indexingState.worker.currentFiles = [];
    indexingState.worker.runningWorkers = 0;
    indexingState.scheduler.phase = "idle";
    log.info(
      {
        reason,
        indexedFiles: indexingState.run.indexedFiles,
        errorCount: indexingState.run.errors.length,
      },
      "index run finished",
    );
    notify();
  }

  async function enqueueReconcileJobs(reason: string): Promise<number> {
    const sources = configService
      .getConfig()
      .sources.filter((source) => source.enabled);

    const sourceFileStats = new Map<string, { size: number; mtimeMs: number }>();
    for (const source of sources) {
      try {
        const files = await collectIndexableFiles(source.path);
        for (const filePath of files) {
          try {
            const fileStat = await stat(filePath);
            sourceFileStats.set(filePath, {
              size: fileStat.size,
              mtimeMs: fileStat.mtimeMs,
            });
          } catch (error) {
            const message = `${filePath}: ${String(error)}`;
            indexingState.run.errors.push(message);
            log.error({ path: filePath, error: String(error) }, "failed to stat source file");
          }
        }
      } catch (error) {
        const message = `${source.path}: ${String(error)}`;
        indexingState.run.errors.push(message);
        log.error({ sourcePath: source.path, error: String(error) }, "failed to scan source");
      }
    }

    const knownFiles = metadata
      .listFiles()
      .filter((file) => file.status !== "deleted");
    const knownByPath = new Map(knownFiles.map((file) => [file.path, file]));

    let enqueued = 0;
    const now = Date.now();
    indexingState.scheduler.phase = "enqueueing";

    for (const [path, fsRow] of sourceFileStats.entries()) {
      const known = knownByPath.get(path);
      const changed = !known || known.size !== fsRow.size || known.mtimeMs !== fsRow.mtimeMs;
      if (!changed) {
        continue;
      }
      metadata.enqueueJob({
        jobId: globalThis.crypto.randomUUID(),
        path,
        jobType: "index",
        reason,
        nextRunAtMs: now,
      });
      enqueued += 1;
      indexingState.scheduler.queueDepth += 1;
    }

    for (const known of knownFiles) {
      if (sourceFileStats.has(known.path)) {
        continue;
      }
      metadata.enqueueJob({
        jobId: globalThis.crypto.randomUUID(),
        path: known.path,
        jobType: "delete",
        reason,
        nextRunAtMs: now,
      });
      enqueued += 1;
      indexingState.scheduler.queueDepth += 1;
    }

    indexingState.scheduler.phase = "idle";
    notify();
    return enqueued;
  }

  async function drainWorkerQueue() {
    indexingState.scheduler.phase = "draining";
    while (true) {
      const flushed = scheduler.flushDue(Date.now());
      const stats = await worker.runOnce(Date.now());
      if (flushed > 0) {
        indexingState.scheduler.queueDepth += flushed;
      }
      if (stats.settled > 0) {
        indexingState.scheduler.queueDepth = Math.max(
          0,
          indexingState.scheduler.queueDepth - stats.settled,
        );
      }
      notify();
      if (flushed === 0 && stats.claimed === 0) {
        break;
      }
    }
    indexingState.scheduler.phase = "idle";
    notify();
  }
}

function normalizeChangeType(type: string): "add" | "change" | "unlink" {
  if (type === "add" || type === "unlink") {
    return type;
  }
  return "change";
}

function isSameOrParentPath(parent: string, child: string) {
  if (parent === child) {
    return true;
  }
  return child.startsWith(`${parent}/`);
}

export function resolveParserExt(path: string) {
  return extname(path).toLowerCase();
}
