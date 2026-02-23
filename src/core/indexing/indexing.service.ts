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

export function createSourceIndexingService(
  configService: ConfigService,
  embedding: EmbeddingProvider,
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
    vector,
    metadata,
  });

  const indexingState: IndexingStatus = {
    running: false,
    lastReason: "",
    lastRunAt: "",
    currentFile: null,
    indexedFiles: 0,
    errors: [],
  };

  const listeners = new Set<(status: IndexingStatus) => void>();
  const notify = () => {
    const snapshot = { ...indexingState, errors: [...indexingState.errors] };
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
    onJobStart(path) {
      indexingState.currentFile = path;
      notify();
    },
    onJobDone() {
      indexingState.indexedFiles += 1;
      indexingState.currentFile = null;
      notify();
    },
    onJobError(path, error) {
      indexingState.errors.push(`${path}: ${error}`);
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
      return { ...indexingState, errors: [...indexingState.errors] };
    },
    subscribe(listener: (status: IndexingStatus) => void) {
      listeners.add(listener);
      listener({ ...indexingState, errors: [...indexingState.errors] });
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
        indexedFiles: indexingState.indexedFiles,
        errors: [...indexingState.errors],
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
        indexedFiles: indexingState.indexedFiles,
        errors: [...indexingState.errors],
      };
    },

    async runScheduledReconcile() {
      const repaired = await enqueueReconcileJobs("scheduled_reconcile");
      await drainWorkerQueue();
      return { repaired };
    },

    getIndexStatus() {
      return statusStore;
    },
  };

  function beginRun(reason: string) {
    indexingState.running = true;
    indexingState.lastReason = reason;
    indexingState.lastRunAt = new Date().toISOString();
    indexingState.currentFile = null;
    indexingState.indexedFiles = 0;
    indexingState.errors = [];
    notify();
  }

  function finishRun(reason: string) {
    indexingState.running = false;
    indexingState.currentFile = null;
    log.info(
      {
        reason,
        indexedFiles: indexingState.indexedFiles,
        errorCount: indexingState.errors.length,
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
            indexingState.errors.push(`${filePath}: ${String(error)}`);
          }
        }
      } catch (error) {
        indexingState.errors.push(`${source.path}: ${String(error)}`);
      }
    }

    const knownFiles = metadata
      .listFiles()
      .filter((file) => file.status !== "deleted");
    const knownByPath = new Map(knownFiles.map((file) => [file.path, file]));

    let enqueued = 0;
    const now = Date.now();

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
    }

    return enqueued;
  }

  async function drainWorkerQueue() {
    while (true) {
      const flushed = scheduler.flushDue(Date.now());
      const processed = await worker.runOnce(Date.now());
      if (flushed === 0 && processed === 0) {
        break;
      }
    }
  }
}

function normalizeChangeType(type: string): "add" | "change" | "unlink" {
  if (type === "add" || type === "unlink") {
    return type;
  }
  return "change";
}

export function resolveParserExt(path: string) {
  return extname(path).toLowerCase();
}
