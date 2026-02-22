import "reflect-metadata";
import { join } from "node:path";
import { container as rootContainer, type DependencyContainer } from "tsyringe";
import { defaultConfigService, type ConfigService } from "../core/config/config.service";
import type { SourceConfig } from "../core/config/config.types";
import { makeEmbeddingProvider } from "../core/embedding/embedding.service";
import type { EmbeddingProvider } from "../core/embedding/embedding.types";
import { createHealthService } from "../core/health/health.service";
import { createSourceIndexingService } from "../core/indexing/indexing.service";
import { createMcpServer } from "../core/mcp/mcp.server";
import { createReranker } from "../core/reranker/reranker.service";
import { createRetrievalService } from "../core/retrieval/retrieval.service";
import { createVectorRepository } from "../core/vector/vector.repository";

type RetrievalService = {
  search: (query: string, opts: { topK?: number }) => Promise<unknown[]>;
};

type HealthService = ReturnType<typeof createHealthService>;
type VectorRepository = ReturnType<typeof createVectorRepository>;
type IndexingService = ReturnType<typeof createSourceIndexingService>;

export type AppContainer = {
  configService: ConfigService;
  healthService: HealthService;
  retrievalService: RetrievalService;
  indexingService: IndexingService;
  addSourceAndReindex: (path: string) => Promise<SourceConfig[]>;
  mcpServer: ReturnType<typeof createMcpServer> | null;
};

const TOKENS = {
  ConfigService: Symbol("ConfigService"),
  HealthService: Symbol("HealthService"),
  EmbeddingProvider: Symbol("EmbeddingProvider"),
  VectorRepository: Symbol("VectorRepository"),
  RetrievalService: Symbol("RetrievalService"),
  IndexingService: Symbol("IndexingService"),
  AppContainer: Symbol("AppContainer"),
} as const;

export function createAppContainer(deps?: {
  configService?: ConfigService;
  vectorCollectionPath?: string;
  userDataDir?: string;
  vectorBaseDir?: string;
}): AppContainer {
  const di = rootContainer.createChildContainer();
  registerDependencies(di, deps);
  return di.resolve<AppContainer>(TOKENS.AppContainer);
}

function registerDependencies(
  di: DependencyContainer,
  deps?: {
    configService?: ConfigService;
    vectorCollectionPath?: string;
    userDataDir?: string;
    vectorBaseDir?: string;
  },
) {
  let vectorRepo: VectorRepository | null = null;
  di.registerInstance<ConfigService>(TOKENS.ConfigService, deps?.configService ?? defaultConfigService);
  di.register(TOKENS.HealthService, {
    useFactory: () => createHealthService(),
  });
  di.register(TOKENS.EmbeddingProvider, {
    useFactory: (c) => {
      const appCfg = c.resolve<ConfigService>(TOKENS.ConfigService).getConfig();
      return makeEmbeddingProvider(appCfg.embedding);
    },
  });
  di.register(TOKENS.VectorRepository, {
    useFactory: (c) => {
      if (vectorRepo) {
        return vectorRepo;
      }
      const cfg = c.resolve<ConfigService>(TOKENS.ConfigService).getConfig();
      const embeddingDimension =
        cfg.embedding.provider === "local"
          ? cfg.embedding.local.dimension
          : cfg.embedding[cfg.embedding.provider].dimension;
      vectorRepo = createVectorRepository({
        collectionPath:
          deps?.vectorCollectionPath ??
          join(
            deps?.vectorBaseDir ?? deps?.userDataDir ?? "build",
            "zvec",
            `provider-${cfg.embedding.provider}`,
            `dim-${embeddingDimension}`,
            "knowdisk.zvec",
          ),
        dimension: embeddingDimension,
        indexType: "hnsw",
        metric: "cosine",
      });
      return vectorRepo;
    },
  });
  di.register(TOKENS.RetrievalService, {
    useFactory: (c) => {
      const cfg = c.resolve<ConfigService>(TOKENS.ConfigService).getConfig();
      const embedding = c.resolve<EmbeddingProvider>(TOKENS.EmbeddingProvider);
      const vector = c.resolve<VectorRepository>(TOKENS.VectorRepository);
      const reranker = createReranker(cfg.reranker);
      return createRetrievalService({
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
        reranker: reranker ?? undefined,
        defaults: { topK: 5 },
      });
    },
  });
  di.register(TOKENS.IndexingService, {
    useFactory: (c) =>
      createSourceIndexingService(
        c.resolve<ConfigService>(TOKENS.ConfigService),
        c.resolve<EmbeddingProvider>(TOKENS.EmbeddingProvider),
        c.resolve<VectorRepository>(TOKENS.VectorRepository),
      ),
  });
  di.register(TOKENS.AppContainer, {
    useFactory: (c) => {
      const configService = c.resolve<ConfigService>(TOKENS.ConfigService);
      const healthService = c.resolve<HealthService>(TOKENS.HealthService);
      const retrievalService = c.resolve<RetrievalService>(TOKENS.RetrievalService);
      const indexingService = c.resolve<IndexingService>(TOKENS.IndexingService);
      const addSourceAndReindex = async (path: string) => {
        const next = configService.updateConfig((source) => {
          if (source.sources.some((item) => item.path === path)) {
            return source;
          }
          return {
            ...source,
            sources: [...source.sources, { path, enabled: true }],
          };
        });
        void indexingService.runFullRebuild("source_added");
        return next.sources;
      };

      if (!configService.getConfig().mcp.enabled) {
        return {
          configService,
          healthService,
          retrievalService,
          indexingService,
          addSourceAndReindex,
          mcpServer: null,
        } satisfies AppContainer;
      }

      const mcpServer = createMcpServer({
        retrieval: retrievalService,
        isEnabled: () => configService.getConfig().mcp.enabled,
      });

      return {
        configService,
        healthService,
        retrievalService,
        indexingService,
        addSourceAndReindex,
        mcpServer,
      } satisfies AppContainer;
    },
  });
}
