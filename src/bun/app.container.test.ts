import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { container as rootContainer } from "tsyringe";
import { createDefaultCoreConfig } from "@knowdisk/core";
import {
  createAppContainer,
  createVfsIndexingHooks,
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
      index: async () => ({ indexed: 0 }),
      delete: async () => {},
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
        return { close() {} } as never;
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
  });
});

describe("createVfsIndexingHooks", () => {
  it("parses/indexes updated files and clears/deletes removed files", async () => {
    const calls: string[] = [];
    const hooks = createVfsIndexingHooks({
      parser: {
        parseNode: ({ nodeId }) => {
          calls.push(`parse:${nodeId}`);
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                chunkIndex: 0,
                text: "chunk",
                markdown: "chunk",
                title: null,
                heading: null,
                sectionId: null,
                sectionPath: [],
                charStart: null,
                charEnd: null,
                tokenEstimate: null,
                source: {
                  nodeId,
                  mountId: "m1",
                  sourceRef: "s1",
                  name: "f1",
                  kind: "file" as const,
                  size: null,
                  mtimeMs: null,
                  providerVersion: null,
                },
                parse: {
                  parserId: "p",
                  parserVersion: "1",
                  converterId: "c",
                  converterVersion: "1",
                },
                status: "ok" as const,
              };
            },
          };
        },
        clear: async ({ nodeId }) => {
          calls.push(`clear:${nodeId}`);
        },
      },
      indexing: {
        index: async ({ node }) => {
          calls.push(`index:${node.nodeId}`);
          return { indexed: 1 };
        },
        delete: async ({ nodeId }) => {
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

    expect(calls).toEqual(["parse:n1", "index:n1", "clear:n1", "delete:n1"]);
  });
});
