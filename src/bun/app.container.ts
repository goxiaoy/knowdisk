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

type IndexingService = {
  index: (input: {
    node: {
      nodeId: string;
      mountId: string;
      sourceRef: string;
      name: string;
      providerVersion: string | null;
    };
    chunks: AsyncIterable<unknown>;
  }) => Promise<{ indexed: number }>;
  delete: (input: { nodeId: string }) => Promise<void>;
};

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
  };
}

export function createVfsIndexingHooks(input: {
  parser: Pick<ParserService, "parseNode" | "clear">;
  indexing: Pick<IndexingService, "index" | "delete">;
  logger: Pick<Logger, "error">;
}): VfsNodeEventHooks {
  const parseAndIndex = async (node: {
    nodeId: string;
    mountId: string;
    sourceRef: string;
    name: string;
    providerVersion: string | null;
  }) => {
    await input.indexing.index({
      node,
      chunks: input.parser.parseNode({ nodeId: node.nodeId }),
    });
  };

  return {
    async afterUpdateContent(ctx) {
      if (ctx.nextNode?.kind !== "file") {
        return;
      }
      try {
        await parseAndIndex(ctx.nextNode);
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
        await input.parser.clear({ nodeId: ctx.prevNode.nodeId });
        await input.indexing.delete({ nodeId: ctx.prevNode.nodeId });
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
      parser: app.parser,
      indexing: app.indexing,
      logger: app.logger,
    })
  );
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
