import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { ConfigService } from "../config/config.types";
import type { EmbeddingProvider } from "../embedding/embedding.types";
import type {
  FileChange,
  IndexingService,
  IndexingStatus,
} from "./indexing.service.types";
import type { LoggerService } from "../logger/logger.service.types";
import { resolveParser } from "../parser/parser.registry";
import type { Parser } from "../parser/parser.types";
import type { VectorRepository } from "../vector/vector.repository.types";

export function createSourceIndexingService(
  configService: ConfigService,
  embedding: EmbeddingProvider,
  vector: Pick<VectorRepository, "upsert" | "deleteBySourcePath">,
  logger?: LoggerService,
): IndexingService {
  const log = logger?.child({ subsystem: "indexing" }) ?? {
    info: (_obj?: unknown, _msg?: string) => {},
    warn: (_obj?: unknown, _msg?: string) => {},
    error: (_obj?: unknown, _msg?: string) => {},
    debug: (_obj?: unknown, _msg?: string) => {},
  };
  const STREAM_THRESHOLD_BYTES = 10 * 1024 * 1024;
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

  const rebuild = async (reason: string) => {
    indexingState.running = true;
    indexingState.lastReason = reason;
    indexingState.lastRunAt = new Date().toISOString();
    indexingState.currentFile = null;
    indexingState.indexedFiles = 0;
    indexingState.errors = [];
    notify();

    const sources = configService
      .getConfig()
      .sources.filter((source) => source.enabled);
    log.info({ reason, sourceCount: sources.length }, "index rebuild started");
    for (const source of sources) {
      try {
        const files = await collectIndexableFiles(source.path);
        log.info(
          { sourcePath: source.path, fileCount: files.length },
          "source indexing started",
        );
        for (const filePath of files) {
          indexingState.currentFile = filePath;
          notify();
          log.debug({ filePath }, "indexing file");
          const parser = resolveParser({
            ext: extname(filePath).toLowerCase(),
          });
          if (parser.id === "unsupported") {
            log.debug({ filePath }, "skipping unsupported file");
            continue;
          }
          await vector.deleteBySourcePath(filePath);
          log.debug({ filePath }, "deleted previous chunks for file");
          const fileStats = await stat(filePath);
          if (fileStats.size > STREAM_THRESHOLD_BYTES) {
            const added = await indexLargeFile(
              filePath,
              parser,
              embedding,
              vector,
            );
            indexingState.indexedFiles += added;
            log.debug(
              {
                filePath,
                chunksIndexed: added,
                bytes: fileStats.size,
                indexedFiles: indexingState.indexedFiles,
              },
              "indexed large file",
            );
            notify();
            continue;
          }
          const added = await indexSmallFile(
            filePath,
            parser,
            embedding,
            vector,
          );
          indexingState.indexedFiles += added;
          log.debug(
            {
              filePath,
              chunksIndexed: added,
              bytes: fileStats.size,
              indexedFiles: indexingState.indexedFiles,
            },
            "indexed small file",
          );
          notify();
        }
        log.info({ sourcePath: source.path }, "source indexing finished");
      } catch (error) {
        indexingState.errors.push(`${source.path}: ${String(error)}`);
        log.error(
          { sourcePath: source.path, error: String(error) },
          "source indexing failed",
        );
        notify();
      }
    }

    indexingState.currentFile = null;
    indexingState.running = false;
    log.info(
      {
        reason,
        indexedFiles: indexingState.indexedFiles,
        errorCount: indexingState.errors.length,
      },
      "index rebuild finished",
    );
    notify();
    return {
      indexedFiles: indexingState.indexedFiles,
      errors: indexingState.errors,
    };
  };

  return {
    async runFullRebuild(reason: string) {
      return rebuild(reason);
    },
    async runIncremental(_changes: FileChange[]) {
      return rebuild("incremental");
    },
    async runScheduledReconcile() {
      return { repaired: 0 };
    },
    getIndexStatus() {
      return statusStore;
    },
  };
}

async function indexSmallFile(
  filePath: string,
  parser: Parser,
  embedding: EmbeddingProvider,
  vector: Pick<VectorRepository, "upsert" | "deleteBySourcePath">,
) {
  const content = await readFile(filePath, "utf8");
  const parsed = parser.parse(content);
  if (parsed.skipped || !parsed.text.trim()) {
    return 0;
  }
  const vectorValue = await embedding.embed(parsed.text);
  const chunkId = createChunkId(filePath);
  await vector.upsert([
    {
      chunkId,
      vector: vectorValue,
      metadata: {
        sourcePath: filePath,
        chunkText: parsed.text,
        updatedAt: new Date().toISOString(),
      },
    },
  ]);
  return 1;
}

async function indexLargeFile(
  filePath: string,
  parser: Parser,
  embedding: EmbeddingProvider,
  vector: Pick<VectorRepository, "upsert" | "deleteBySourcePath">,
) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  let indexedChunks = 0;
  for await (const parsed of parser.parseStream(stream)) {
    if (parsed.skipped || !parsed.text.trim()) {
      continue;
    }
    const vectorValue = await embedding.embed(parsed.text);
    const chunkId = createChunkId(
      filePath,
      parsed.startOffset,
      parsed.endOffset,
    );
    await vector.upsert([
      {
        chunkId,
        vector: vectorValue,
        metadata: {
          sourcePath: filePath,
          chunkText: parsed.text,
          startOffset: parsed.startOffset,
          endOffset: parsed.endOffset,
          tokenEstimate: parsed.tokenEstimate,
          updatedAt: new Date().toISOString(),
        },
      },
    ]);
    indexedChunks += 1;
  }
  return indexedChunks;
}

function createChunkId(
  sourcePath: string,
  startOffset?: number,
  endOffset?: number,
) {
  const key = `${sourcePath}#${startOffset ?? ""}#${endOffset ?? ""}`;
  return `doc_${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

async function collectIndexableFiles(sourcePath: string): Promise<string[]> {
  const sourceStat = await stat(sourcePath);
  if (sourceStat.isFile()) {
    return [sourcePath];
  }

  if (!sourceStat.isDirectory()) {
    return [];
  }

  const results: string[] = [];
  const queue = [sourcePath];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }
  return results;
}
