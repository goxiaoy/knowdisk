import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { ConfigService } from "../config/config.types";
import type { EmbeddingProvider } from "../embedding/embedding.types";
import { resolveParser } from "../parser/parser.registry";
import type { VectorRow } from "../vector/vector.repository";

export type FileChange = {
  path: string;
  type: string;
};

export function createIndexingService(
  rebuild: (reason: string) => Promise<unknown>,
  incremental: (changes: FileChange[]) => Promise<unknown>,
  reconcile: () => Promise<{ repaired: number }>,
  status: () => unknown,
) {
  return {
    async runFullRebuild(reason: string) {
      return rebuild(reason);
    },
    async runIncremental(changes: FileChange[]) {
      return incremental(changes);
    },
    async runScheduledReconcile() {
      return reconcile();
    },
    getIndexStatus() {
      return status();
    },
  };
}

export function createSourceIndexingService(
  configService: ConfigService,
  embedding: EmbeddingProvider,
  vector: { upsert: (rows: VectorRow[]) => Promise<void> },
) {
  const indexingState = {
    running: false,
    lastReason: "",
    lastRunAt: "",
    indexedFiles: 0,
    errors: [] as string[],
  };

  const rebuild = async (reason: string) => {
    indexingState.running = true;
    indexingState.lastReason = reason;
    indexingState.lastRunAt = new Date().toISOString();
    indexingState.errors = [];
    let indexedFiles = 0;

    const sources = configService.getConfig().sources.filter((source) => source.enabled);
    for (const source of sources) {
      try {
        const files = await collectIndexableFiles(source.path);
        for (const filePath of files) {
          const parser = resolveParser({ ext: extname(filePath).toLowerCase() });
          if (parser.id === "unsupported") {
            continue;
          }
          const content = await readFile(filePath, "utf8");
          const parsed = parser.parse(content);
          if (parsed.skipped || !parsed.text.trim()) {
            continue;
          }
          const vectorValue = await embedding.embed(parsed.text);
          const row: VectorRow = {
            chunkId: filePath,
            vector: vectorValue,
            metadata: {
              sourcePath: filePath,
              chunkText: parsed.text.slice(0, 1000),
              updatedAt: new Date().toISOString(),
            },
          };
          await vector.upsert([row]);
          indexedFiles += 1;
        }
      } catch (error) {
        indexingState.errors.push(`${source.path}: ${String(error)}`);
      }
    }

    indexingState.indexedFiles = indexedFiles;
    indexingState.running = false;
    return { indexedFiles, errors: indexingState.errors };
  };

  return createIndexingService(
    rebuild,
    async () => rebuild("incremental"),
    async () => ({ repaired: 0 }),
    () => ({ ...indexingState }),
  );
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
