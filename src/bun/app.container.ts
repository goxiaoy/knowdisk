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
  createVfsProviderRegistry,
  createVfsRepository,
  createVfsService,
  type VfsNodeEventHooks,
  type VfsRepository,
  type VfsService,
} from "@knowdisk/vfs";
import type { Logger } from "pino";
import { container as rootContainer, type DependencyContainer } from "tsyringe";
import { resolveRepoPythonProjectDirFromModule } from "./python/command";

type NodeIndexingService = {
  indexNode(input: { nodeId: string }): Promise<unknown>;
  deleteNode(input: { nodeId: string }): Promise<unknown>;
};

export type AppContainerPaths = {
  basePath: string;
  pythonProjectDir: string;
  vfsDbPath: string;
  vfsContentRootDir: string;
};

export type AppContainerDeps = {
  createLoggerService: typeof createLoggerService;
  createVfsRepository: typeof createVfsRepository;
  createVfsProviderRegistry: typeof createVfsProviderRegistry;
  createVfsService: typeof createVfsService;
};

export type AppContainer = {
  container: DependencyContainer;
  config: CoreConfig;
  paths: AppContainerPaths;
  logger: Logger;
  vfsRepository: VfsRepository;
  vfs: VfsService;
  close(): Promise<void>;
};

const TOKENS = {
  loggerService: "LoggerService",
  coreConfig: "CoreConfig",
  fetchService: "Fetch",
  vfsRepository: "VfsRepository",
  vfsService: "VfsService",
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
  container.registerInstance(TOKENS.coreConfig, config);
  container.registerInstance(TOKENS.fetchService, fetch);

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

  return {
    container,
    config,
    paths,
    logger,
    vfsRepository,
    vfs,
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
  indexing: Pick<NodeIndexingService, "indexNode" | "deleteNode">;
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

function resolveAppPaths(basePath: string): AppContainerPaths {
  const normalizedBasePath = basePath.trim();
  if (!normalizedBasePath) {
    throw new Error("basePath is required");
  }
  return {
    basePath: normalizedBasePath,
    pythonProjectDir: resolveRepoPythonProjectDirFromModule(import.meta.url),
    vfsDbPath: join(normalizedBasePath, "vfs", "vfs.db"),
    vfsContentRootDir: join(normalizedBasePath, "vfs", "content"),
  };
}

function ensureAppDirectories(paths: AppContainerPaths): void {
  mkdirSync(paths.basePath, { recursive: true });
  mkdirSync(join(paths.vfsDbPath, ".."), { recursive: true });
  mkdirSync(paths.vfsContentRootDir, { recursive: true });
}
