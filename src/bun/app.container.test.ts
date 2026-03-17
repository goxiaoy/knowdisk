import "reflect-metadata";
import { describe, expect, it, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { container as rootContainer } from "tsyringe";
import { createDefaultCoreConfig } from "@knowdisk/core";
import {
  createPythonWorkerCommand,
  createAppContainer,
  createVfsIndexingHooks,
  initializeAppRuntime,
  type AppContainerDeps,
  type AppContainerPaths,
} from "./app.container";

describe("createAppContainer", () => {
  it("registers logger/config/model/vfs/indexing/parser services with basePath-derived paths", () => {
    const basePath = mkdtempSync(join(tmpdir(), "knowdisk-app-container-"));
    const config = createDefaultCoreConfig();
    config.basePath = basePath;

    const calls: Record<string, unknown> = {};
    const logger = { error() {}, info() {} };
    const vfsRepository = { close() {} };
    const vfsRegistry = {};
    const vfsService = { registerNodeEventHooks: () => () => {} };
    const parserService = {
      parseNode: () => ({
        async *[Symbol.asyncIterator]() {},
      }),
      clear: async () => {},
    };
    const indexingService = {
      indexNode: async () => ({ indexed: 0 }),
      deleteNode: async () => {},
      rebuildAllFromLocalNodes: async () => {},
      getStatus: () => ({
        getSnapshot: () => ({
          phase: "idle" as const,
          scope: null,
          processedFiles: 0,
          totalFiles: 0,
          activeNodeName: null,
          error: "",
        }),
        subscribe: () => () => {},
      }),
      search: async () => ({
        hybrid: [],
        fts: [],
        vector: [],
        reranked: [],
        meta: {
          query: "",
          topK: 5,
          titleOnly: false,
          embeddingProvider: "stub",
          rerankerProvider: null,
        },
      }),
    };
    const vectorRepository = {
      getChunkCount: async () => 0,
      consumeRecoveryState: () => ({ recovered: false }),
      close() {},
    };
    const modelService = {
      ensureRequiredModels: async () => {},
      getLocalEmbeddingExtractor: async () => {
        throw new Error("not implemented");
      },
      getLocalRerankerRuntime: async () => {
        throw new Error("not implemented");
      },
      retryNow: async () => ({ ok: true }),
      redownloadEmbeddingModel: async () => ({ ok: true }),
      redownloadRerankerModel: async () => ({ ok: true }),
      getStatus: () => ({
        getSnapshot: () => ({
          phase: "idle" as const,
          lastStartedAt: "",
          lastFinishedAt: "",
          progressPct: 0,
          error: "",
          tasks: { embedding: null, reranker: null },
          retry: {
            attempt: 0,
            maxAttempts: 0,
            backoffMs: [],
            nextRetryAt: "",
            exhausted: false,
          },
        }),
        subscribe: () => () => {},
      }),
    };

    const deps: AppContainerDeps = {
      createLoggerService: () => logger as never,
      createVfsRepository: (input) => {
        calls.vfsDbPath = input.dbPath;
        return vfsRepository as never;
      },
      createVfsProviderRegistry: (container) => {
        calls.vfsRegistryContainer = container;
        return vfsRegistry as never;
      },
      createVfsService: (input) => {
        calls.vfsContentRootParent = input.contentRootParent;
        return vfsService as never;
      },
      createParserService: (input) => {
        calls.parserBasePath = input.basePath;
        return parserService as never;
      },
      createFtsRepository: (input) => {
        calls.indexingDbPath = input.dbPath;
        return { close() {} } as never;
      },
      createVectorRepository: (input) => {
        calls.indexingVectorPath = input.collectionPath;
        return vectorRepository as never;
      },
      createIndexingServiceFromConfig: (container) => {
        calls.indexingContainer = container;
        return indexingService as never;
      },
      createModelService: (input) => {
        calls.modelCacheDir = input.cacheDir;
        calls.modelFetch = input.deps?.fetch;
        return modelService as never;
      },
    };

    const app = createAppContainer({
      container: rootContainer.createChildContainer(),
      coreConfig: config,
      deps,
    });

    expect(app.paths.basePath).toBe(basePath);
    expect(app.paths.pythonProjectDir).toBe(join(process.cwd(), "python"));
    expect((app.paths as AppContainerPaths).modelCacheDir).toBe(join(basePath, "models"));
    expect(calls.vfsDbPath).toBe(join(basePath, "vfs", "vfs.db"));
    expect(calls.vfsContentRootParent).toBe(join(basePath, "vfs", "content"));
    expect(calls.parserBasePath).toBe(join(basePath, "parser", "cache"));
    expect(calls.indexingDbPath).toBe(join(basePath, "indexing", "index.db"));
    expect(calls.indexingVectorPath).toBe(join(basePath, "indexing", "index.zvec"));
    expect(calls.modelCacheDir).toBe(join(basePath, "models"));
    expect(calls.modelFetch).toBe(fetch);

    expect(app.container.resolve("CoreConfig")).toBe(config);
    expect(app.container.resolve("ModelService")).toBe(modelService);
    expect(app.container.resolve("VfsService")).toBe(vfsService);
    expect(app.container.resolve("ParserService")).toBe(parserService);
    expect(app.container.resolve("IndexingService")).toBe(indexingService);
    expect(app.vectorRepository).toBe(vectorRepository);
  });

  it("builds the python worker command from app paths", () => {
    expect(
      createPythonWorkerCommand({
        pythonProjectDir: "/tmp/knowdisk/python",
      })
    ).toEqual(["uv", "run", "--project", "/tmp/knowdisk/python", "python", "-m", "worker"]);
  });

  it("closes vfs and indexing repositories during shutdown", async () => {
    const closed: string[] = [];
    const app = createAppContainer({
      container: rootContainer.createChildContainer(),
      coreConfig: (() => {
        const config = createDefaultCoreConfig();
        config.basePath = mkdtempSync(join(tmpdir(), "knowdisk-app-close-"));
        return config;
      })(),
      deps: {
        createLoggerService: () =>
          ({
            error() {},
            info() {},
          }) as never,
        createVfsRepository: () =>
          ({
            close() {
              closed.push("vfsRepository");
            },
          }) as never,
        createVfsProviderRegistry: () => ({} as never),
        createVfsService: () =>
          ({
            registerNodeEventHooks: () => () => {},
            close: async () => {
              closed.push("vfs");
            },
          }) as never,
        createParserService: () =>
          ({
            parseNode: () => ({
              async *[Symbol.asyncIterator]() {},
            }),
            clear: async () => {},
          }) as never,
        createFtsRepository: () =>
          ({
            close() {
              closed.push("fts");
            },
          }) as never,
        createVectorRepository: () =>
          ({
            getChunkCount: async () => 0,
            consumeRecoveryState: () => ({ recovered: false }),
            close() {
              closed.push("vector");
            },
          }) as never,
        createIndexingServiceFromConfig: () =>
          ({
            indexNode: async () => ({ indexed: 0 }),
            deleteNode: async () => {},
            rebuildAllFromLocalNodes: async () => {},
            getStatus: () => ({
              getSnapshot: () => ({
                phase: "idle" as const,
                scope: null,
                processedFiles: 0,
                totalFiles: 0,
                activeNodeName: null,
                error: "",
              }),
              subscribe: () => () => {},
            }),
            search: async () => ({
              hybrid: [],
              fts: [],
              vector: [],
              reranked: [],
              meta: {
                query: "",
                topK: 5,
                titleOnly: false,
                embeddingProvider: "stub",
                rerankerProvider: null,
              },
            }),
          }) as never,
        createModelService: () =>
          ({
            ensureRequiredModels: async () => {},
            getLocalEmbeddingExtractor: async () => {
              throw new Error("not implemented");
            },
            getLocalRerankerRuntime: async () => {
              throw new Error("not implemented");
            },
            retryNow: async () => ({ ok: true }),
            redownloadEmbeddingModel: async () => ({ ok: true }),
            redownloadRerankerModel: async () => ({ ok: true }),
            getStatus: () => ({
              getSnapshot: () => ({
                phase: "idle" as const,
                lastStartedAt: "",
                lastFinishedAt: "",
                progressPct: 0,
                error: "",
                tasks: { embedding: null, reranker: null },
                retry: {
                  attempt: 0,
                  maxAttempts: 0,
                  backoffMs: [],
                  nextRetryAt: "",
                  exhausted: false,
                },
              }),
              subscribe: () => () => {},
            }),
          }) as never,
      },
    });

    await app.close();

    expect(closed).toEqual(["vfs", "vfsRepository", "fts", "vector"]);
  });
});

describe("createVfsIndexingHooks", () => {
  it("skips parse/index for unsupported video files", async () => {
    const calls: string[] = [];
    const hooks = createVfsIndexingHooks({
      indexing: {
        indexNode: async ({ nodeId }) => {
          calls.push(`index:${nodeId}`);
          return { indexed: 0 };
        },
        deleteNode: async ({ nodeId }) => {
          calls.push(`delete:${nodeId}`);
        },
      },
      logger: {
        error: () => {},
      },
    });

    await hooks.afterUpdateContent?.({
      mount: {
        mountId: "m1",
        providerType: "local",
        providerExtra: {},
        autoSync: true,
        syncMetadata: true,
        syncContent: true,
        metadataTtlSec: 0,
        reconcileIntervalMs: 1000,
      },
      event: {
        eventId: "e-video",
        sourceRef: "videos/clip.mkv",
        mountId: "m1",
        parentId: null,
        type: "update_content",
        nodeJson: "",
        createdAtMs: Date.now(),
      },
      prevNode: null,
      nextNode: {
        nodeId: "video-1",
        mountId: "m1",
        parentId: null,
        name: "clip.mkv",
        kind: "file",
        size: null,
        mtimeMs: null,
        sourceRef: "videos/clip.mkv",
        providerVersion: null,
        deletedAtMs: null,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      },
    });

    expect(calls).toEqual(["index:video-1"]);
  });

  it("parses/indexes updated files and clears/deletes removed files", async () => {
    const calls: string[] = [];
    const hooks = createVfsIndexingHooks({
      indexing: {
        indexNode: async ({ nodeId }) => {
          calls.push(`index:${nodeId}`);
          return { indexed: 1 };
        },
        deleteNode: async ({ nodeId }) => {
          calls.push(`delete:${nodeId}`);
        },
      },
      logger: {
        error: () => {},
      },
    });

    await hooks.afterUpdateContent?.({
      mount: {
        mountId: "m1",
        providerType: "local",
        providerExtra: {},
        autoSync: true,
        syncMetadata: true,
        syncContent: true,
        metadataTtlSec: 0,
        reconcileIntervalMs: 1000,
      },
      event: {
        eventId: "e1",
        sourceRef: "s1",
        mountId: "m1",
        parentId: null,
        type: "update_content",
        nodeJson: "",
        createdAtMs: Date.now(),
      },
      prevNode: null,
      nextNode: {
        nodeId: "n1",
        mountId: "m1",
        parentId: null,
        name: "f1",
        kind: "file",
        size: null,
        mtimeMs: null,
        sourceRef: "s1",
        providerVersion: null,
        deletedAtMs: null,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      },
    });

    await hooks.afterDelete?.({
      mount: {
        mountId: "m1",
        providerType: "local",
        providerExtra: {},
        autoSync: true,
        syncMetadata: true,
        syncContent: true,
        metadataTtlSec: 0,
        reconcileIntervalMs: 1000,
      },
      event: {
        eventId: "e2",
        sourceRef: "s1",
        mountId: "m1",
        parentId: null,
        type: "delete",
        nodeJson: "",
        createdAtMs: Date.now(),
      },
      prevNode: {
        nodeId: "n1",
        mountId: "m1",
        parentId: null,
        name: "f1",
        kind: "file",
        size: null,
        mtimeMs: null,
        sourceRef: "s1",
        providerVersion: null,
        deletedAtMs: null,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      },
      nextNode: null,
    });

    expect(calls).toEqual(["index:n1", "delete:n1"]);
  });
});

describe("initializeAppRuntime", () => {
  it("starts a background full reindex when vector storage was recovered", async () => {
    const calls: string[] = [];
    let resolveWalk: (() => void) | null = null;
    const walkReady = new Promise<void>((resolve) => {
      resolveWalk = resolve;
    });

    const stop = initializeAppRuntime({
      vfs: {
        registerNodeEventHooks: () => () => {},
        walkChildren: mock(async () => ({ items: [], source: "local" as const })),
      } as never,
      indexing: {
        indexNode: async () => ({ indexed: 0 }),
        deleteNode: async () => {},
        rebuildAllFromLocalNodes: async () => {
          calls.push("rebuild");
          await walkReady;
          calls.push("rebuilt");
        },
        getStatus: () => ({
          getSnapshot: () => ({
            phase: "idle" as const,
            scope: null,
            processedFiles: 0,
            totalFiles: 0,
            activeNodeName: null,
            error: "",
          }),
          subscribe: () => () => {},
        }),
        search: async () => ({
          hybrid: [],
          fts: [],
          vector: [],
          reranked: [],
          meta: {
            query: "",
            topK: 5,
            titleOnly: false,
            embeddingProvider: "stub",
            rerankerProvider: null,
          },
        }),
      } as never,
      logger: {
        error: () => {},
      } as never,
      vectorRepository: {
        consumeRecoveryState: () => ({ recovered: true }),
      } as never,
    } as never);

    resolveWalk?.();
    await waitFor(() => calls.includes("rebuilt"));

    expect(calls).toEqual(["rebuild", "rebuilt"]);

    stop();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 200): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("waitFor timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
