import "reflect-metadata";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  createDefaultCoreConfig,
  createLoggerService,
  validateCoreConfig,
  type CoreConfig,
} from "@knowdisk/core";
import {
  createFtsRepository,
  createIndexingServiceFromConfig,
  createVectorRepository,
  type VectorRepository,
} from "@knowdisk/indexing";
import { createModelService } from "@knowdisk/model";
import { createParserService, type ParserService } from "@knowdisk/parser";
import {
  createVfsProviderRegistry,
  createVfsRepository,
  createVfsService,
  type VfsNodeEventHooks,
  type VfsService,
} from "@knowdisk/vfs";
import type { Logger } from "pino";
import { container as rootContainer, type DependencyContainer } from "tsyringe";
type IndexingService = ReturnType<typeof createIndexingServiceFromConfig>;

type ModelService = ReturnType<typeof createModelService>;

export type AppContainerPaths = {
  basePath: string;
  modelCacheDir: string;
  vfsDbPath: string;
  vfsContentRootDir: string;
  parserCacheDir: string;
  indexingDbPath: string;
  indexingVectorPath: string;
};

export type AppContainerDeps = {
  createLoggerService: typeof createLoggerService;
  createVfsRepository: typeof createVfsRepository;
  createVfsProviderRegistry: typeof createVfsProviderRegistry;
  createVfsService: typeof createVfsService;
  createParserService: typeof createParserService;
  createFtsRepository: typeof createFtsRepository;
  createVectorRepository: typeof createVectorRepository;
  createIndexingServiceFromConfig: typeof createIndexingServiceFromConfig;
  createModelService: typeof createModelService;
};

export type AppContainer = {
  container: DependencyContainer;
  config: CoreConfig;
  paths: AppContainerPaths;
  logger: Logger;
  modelService: ModelService;
  vfs: VfsService;
  parser: ParserService;
  indexing: IndexingService;
  vectorRepository: VectorRepository;
  close(): Promise<void>;
};

const TOKENS = {
  loggerService: "LoggerService",
  loggerServiceLegacy: "logger",
  coreConfig: "CoreConfig",
  fetchService: "Fetch",
  fetchServiceLegacy: "fetch",
  modelService: "ModelService",
  vfsRepository: "VfsRepository",
  vfsService: "VfsService",
  parserService: "ParserService",
  ftsRepository: "FtsRepository",
  vectorRepository: "VectorRepository",
  indexingService: "IndexingService",
} as const;

export function createAppContainer(input?: {
  container?: DependencyContainer;
  coreConfig?: CoreConfig;
  deps?: Partial<AppContainerDeps>;
}): AppContainer {
  const deps: AppContainerDeps = {
    createLoggerService,
    createVfsRepository,
    createVfsProviderRegistry,
    createVfsService,
    createParserService,
    createFtsRepository,
    createVectorRepository,
    createIndexingServiceFromConfig,
    createModelService,
    ...input?.deps,
  };
  const container = input?.container ?? rootContainer.createChildContainer();
  const config = input?.coreConfig ?? createDefaultCoreConfig();
  const validation = validateCoreConfig(config);
  if (!validation.ok) {
    throw new Error(`Invalid CoreConfig: ${validation.errors.join("; ")}`);
  }

  const paths = resolveAppPaths(config.basePath);
  ensureAppDirectories(paths);

  const logger = deps.createLoggerService({
    name: config.logger.name,
    level: config.logger.level,
  });
  container.registerInstance(TOKENS.loggerService, logger);
  container.registerInstance(TOKENS.loggerServiceLegacy, logger);
  container.registerInstance(TOKENS.coreConfig, config);
  container.registerInstance(TOKENS.fetchService, fetch);
  container.registerInstance(TOKENS.fetchServiceLegacy, fetch);

  const modelService = deps.createModelService({
    logger,
    config,
    cacheDir: paths.modelCacheDir,
    deps: {
      fetch: container.resolve(TOKENS.fetchService),
    },
  });
  container.registerInstance(TOKENS.modelService, modelService);

  const vfsRepository = deps.createVfsRepository({ dbPath: paths.vfsDbPath });
  const vfsRegistry = deps.createVfsProviderRegistry(container);
  const vfs = deps.createVfsService({
    repository: vfsRepository,
    registry: vfsRegistry,
    contentRootParent: paths.vfsContentRootDir,
    logger,
  });
  container.registerInstance(TOKENS.vfsRepository, vfsRepository);
  container.registerInstance(TOKENS.vfsService, vfs);

  const parser = deps.createParserService({
    vfs,
    basePath: paths.parserCacheDir,
    logger,
  });
  container.registerInstance(TOKENS.parserService, parser);

  const ftsRepository = deps.createFtsRepository({ dbPath: paths.indexingDbPath });
  const vectorRepository = deps.createVectorRepository({
    collectionPath: paths.indexingVectorPath,
  });
  const indexing = deps.createIndexingServiceFromConfig(container, {
    logger,
    ftsRepository,
    vectorRepository,
  });
  container.registerInstance(TOKENS.ftsRepository, ftsRepository);
  container.registerInstance(TOKENS.vectorRepository, vectorRepository);
  container.registerInstance(TOKENS.indexingService, indexing);

  return {
    container,
    config,
    paths,
    logger,
    modelService,
    vfs,
    parser,
    indexing,
    vectorRepository,
    async close() {
      const errors: Error[] = [];
      try {
        await vfs.close();
      } catch (error) {
        errors.push(
          error instanceof Error ? error : new Error(String(error))
        );
      }
      for (const close of [
        () => vfsRepository.close(),
        () => ftsRepository.close(),
        () => vectorRepository.close(),
      ]) {
        try {
          close();
        } catch (error) {
          errors.push(
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "failed to close application resources");
      }
    },
  };
}

export function createVfsIndexingHooks(input: {
  indexing: Pick<IndexingService, "indexNode" | "deleteNode">;
  logger: Pick<Logger, "error">;
}): VfsNodeEventHooks {
  return {
    async afterUpdateContent(ctx) {
      if (ctx.nextNode?.kind !== "file") {
        return;
      }
      try {
        await input.indexing.indexNode({ nodeId: ctx.nextNode.nodeId });
      } catch (error) {
        input.logger.error(
          {
            nodeId: ctx.nextNode.nodeId,
            error: error instanceof Error ? error.message : String(error),
          },
          "failed to parse/index updated node"
        );
      }
    },
    async afterDelete(ctx) {
      if (ctx.prevNode?.kind !== "file") {
        return;
      }
      try {
        await input.indexing.deleteNode({ nodeId: ctx.prevNode.nodeId });
      } catch (error) {
        input.logger.error(
          {
            nodeId: ctx.prevNode.nodeId,
            error: error instanceof Error ? error.message : String(error),
          },
          "failed to clear parser/index artifacts for deleted node"
        );
      }
    },
  };
}

export function initializeAppRuntime(app: AppContainer): () => void {
  const offHooks = app.vfs.registerNodeEventHooks(
    createVfsIndexingHooks({
      indexing: app.indexing,
      logger: app.logger,
    })
  );
  if (app.vectorRepository.consumeRecoveryState().recovered) {
    void app.indexing.rebuildAllFromLocalNodes();
  }
  return () => {
    offHooks();
  };
}

function resolveAppPaths(basePath: string): AppContainerPaths {
  const normalizedBasePath = basePath.trim();
  if (!normalizedBasePath) {
    throw new Error("basePath is required");
  }
  return {
    basePath: normalizedBasePath,
    modelCacheDir: join(normalizedBasePath, "models"),
    vfsDbPath: join(normalizedBasePath, "vfs", "vfs.db"),
    vfsContentRootDir: join(normalizedBasePath, "vfs", "content"),
    parserCacheDir: join(normalizedBasePath, "parser", "cache"),
    indexingDbPath: join(normalizedBasePath, "indexing", "index.db"),
    indexingVectorPath: join(normalizedBasePath, "indexing", "index.zvec"),
  };
}

function ensureAppDirectories(paths: AppContainerPaths): void {
  mkdirSync(paths.basePath, { recursive: true });
  mkdirSync(paths.modelCacheDir, { recursive: true });
  mkdirSync(join(paths.vfsDbPath, ".."), { recursive: true });
  mkdirSync(paths.vfsContentRootDir, { recursive: true });
  mkdirSync(paths.parserCacheDir, { recursive: true });
  mkdirSync(join(paths.indexingDbPath, ".."), { recursive: true });
  mkdirSync(join(paths.indexingVectorPath, ".."), { recursive: true });
}
