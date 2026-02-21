import { extname, join } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { defaultConfigService, type ConfigService } from "../core/config/config.service";
import { makeEmbeddingProvider } from "../core/embedding/embedding.service";
import { createHealthService } from "../core/health/health.service";
import { createIndexingService } from "../core/indexing/indexing.service";
import { createMcpServer } from "../core/mcp/mcp.server";
import { createRetrievalService } from "../core/retrieval/retrieval.service";
import { createVectorRepository } from "../core/vector/vector.repository";
import type { SourceConfig } from "../core/config/config.types";

type RetrievalService = {
  search: (query: string, opts: { topK?: number }) => Promise<unknown[]>;
};

type HealthService = ReturnType<typeof createHealthService>;

export type AppContainer = {
  configService: ConfigService;
  healthService: HealthService;
  retrievalService: RetrievalService;
  indexingService: ReturnType<typeof createIndexingService>;
  addSourceAndReindex: (path: string) => Promise<SourceConfig[]>;
  mcpServer: ReturnType<typeof createMcpServer> | null;
};

export function createAppContainer(deps?: { configService?: ConfigService }): AppContainer {
  const configService = deps?.configService ?? defaultConfigService;
  const healthService = createHealthService();

  const embedding = makeEmbeddingProvider({ mode: "local", model: "bge-small" });
  const vector = createVectorRepository();

  const retrievalService = createRetrievalService({
    embedding,
    vector: {
      async search(queryVector, opts) {
        const rows = await vector.search(queryVector, opts);
        return rows.map((row) => ({
          ...row,
          metadata: {
            sourcePath: row.metadata.sourcePath,
            chunkText: row.metadata.chunkText ?? "",
            updatedAt: row.metadata.updatedAt ?? "",
          },
        }));
      },
    },
    defaults: { topK: 5 },
  });
  const indexingState = {
    running: false,
    lastReason: "",
    lastRunAt: "",
    indexedFiles: 0,
    errors: [] as string[],
  };

  const indexingService = createIndexingService({
    pipeline: {
      async rebuild(reason: string) {
        indexingState.running = true;
        indexingState.lastReason = reason;
        indexingState.lastRunAt = new Date().toISOString();
        indexingState.errors = [];
        let indexedFiles = 0;

        const sources = configService.getSources().filter((source) => source.enabled);
        for (const source of sources) {
          try {
            const files = await collectIndexableFiles(source.path);
            for (const filePath of files) {
              const content = await readFile(filePath, "utf8");
              const vectorValue = await embedding.embed(content);
              await vector.upsert([
                {
                  chunkId: filePath,
                  vector: vectorValue,
                  metadata: {
                    sourcePath: filePath,
                    chunkText: content.slice(0, 1000),
                    updatedAt: new Date().toISOString(),
                  },
                },
              ]);
              indexedFiles += 1;
            }
          } catch (error) {
            indexingState.errors.push(`${source.path}: ${String(error)}`);
          }
        }

        indexingState.indexedFiles = indexedFiles;
        indexingState.running = false;
        return { indexedFiles, errors: indexingState.errors };
      },
      async incremental() {
        return this.rebuild("incremental");
      },
      async reconcile() {
        return { repaired: 0 };
      },
      status() {
        return { ...indexingState };
      },
    },
  });

  const addSourceAndReindex = async (path: string) => {
    const sources = configService.addSource(path);
    void indexingService.runFullRebuild("source_added");
    return sources;
  };

  if (!configService.getMcpEnabled()) {
    return {
      configService,
      healthService,
      retrievalService,
      indexingService,
      addSourceAndReindex,
      mcpServer: null,
    };
  }

  const mcpServer = createMcpServer({
    retrieval: retrievalService,
    isEnabled: () => configService.getMcpEnabled(),
  });

  return {
    configService,
    healthService,
    retrievalService,
    indexingService,
    addSourceAndReindex,
    mcpServer,
  };
}

const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".yml", ".yaml"]);

async function collectIndexableFiles(sourcePath: string): Promise<string[]> {
  const sourceStat = await stat(sourcePath);
  if (sourceStat.isFile()) {
    return TEXT_EXTENSIONS.has(extname(sourcePath)) ? [sourcePath] : [];
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
      } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(fullPath))) {
        results.push(fullPath);
      }
    }
  }

  return results;
}
