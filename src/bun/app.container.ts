import "reflect-metadata";
import { join } from "node:path";
import { extname } from "node:path";
import {
  container as rootContainer,
  instanceCachingFactory,
  type DependencyContainer,
} from "tsyringe";
import { defaultConfigService } from "../core/config/config.service";
import type { ConfigService } from "../core/config/config.types";
import { makeEmbeddingProvider } from "../core/embedding/embedding.service";
import type { EmbeddingProvider } from "../core/embedding/embedding.types";
import { createSourceIndexingService } from "../core/indexing/indexing.service";
import type { IndexingService } from "../core/indexing/indexing.service.types";
import { createChunkingService } from "../core/indexing/chunker/chunker.service";
import type { ChunkingService } from "../core/indexing/chunker/chunker.service.types";
import { createIndexMetadataRepository } from "../core/indexing/metadata/index-metadata.repository";
import type { IndexMetadataRepository } from "../core/indexing/metadata/index-metadata.repository.types";
import { createLoggerService } from "../core/logger/logger.service";
import type { LoggerService } from "../core/logger/logger.service.types";
import { createMcpServer } from "../core/mcp/mcp.server";
import type { McpServerService } from "../core/mcp/mcp.server.types";
import { createModelDownloadService } from "../core/model/model-download.service";
import type { ModelDownloadService } from "../core/model/model-download.service.types";
import { createReranker } from "../core/reranker/reranker.service";
import { createRetrievalService } from "../core/retrieval/retrieval.service";
import type { RetrievalService } from "../core/retrieval/retrieval.service.types";
import { createVectorRepository } from "../core/vector/vector.repository";
import type { VectorRepository } from "../core/vector/vector.repository.types";
import { resolveParser } from "../core/parser/parser.registry";
import { createChatRepository } from "../core/chat/chat.repository";
import type { ChatRepository } from "../core/chat/chat.repository.types";
import { createChatService } from "../core/chat/chat.service";
import type { ChatService } from "../core/chat/chat.service.types";
import { createVfsRepository } from "../core/vfs/vfs.repository";
import type { VfsRepository } from "../core/vfs/vfs.repository.types";
import { createVfsProviderRegistry, type VfsProviderRegistry } from "../core/vfs/vfs.provider.registry";
import { createVfsService } from "../core/vfs/vfs.service";
import type { VfsService } from "../core/vfs/vfs.service.types";

export type AppContainer = {
  loggerService: LoggerService;
  configService: ConfigService;
  vectorRepository: VectorRepository;
  retrievalService: RetrievalService;
  indexingService: IndexingService;
  modelDownloadService: ModelDownloadService;
  chatService: ChatService;
  vfsService: VfsService;
  close: () => void;
  mcpServer: McpServerService | null;
};

const TOKENS = {
  ConfigService: Symbol("ConfigService"),
  LoggerService: Symbol("LoggerService"),
  EmbeddingProvider: Symbol("EmbeddingProvider"),
  ChunkingService: Symbol("ChunkingService"),
  VectorRepository: Symbol("VectorRepository"),
  RetrievalService: Symbol("RetrievalService"),
  IndexingService: Symbol("IndexingService"),
  ModelDownloadService: Symbol("ModelDownloadService"),
  ChatRepository: Symbol("ChatRepository"),
  ChatService: Symbol("ChatService"),
  VfsRepository: Symbol("VfsRepository"),
  VfsProviderRegistry: Symbol("VfsProviderRegistry"),
  VfsService: Symbol("VfsService"),
  IndexMetadataRepository: Symbol("IndexMetadataRepository"),
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
  let metadataRepo: IndexMetadataRepository | null = null;
  let chatRepo: ChatRepository | null = null;
  let vfsRepo: VfsRepository | null = null;
  di.registerInstance<ConfigService>(
    TOKENS.ConfigService,
    deps?.configService ?? defaultConfigService,
  );
  di.register(TOKENS.LoggerService, {
    useFactory: instanceCachingFactory(() => createLoggerService({ name: "knowdisk" })),
  });
  di.register(TOKENS.EmbeddingProvider, {
    useFactory: instanceCachingFactory((c) => {
      const configService = c.resolve<ConfigService>(TOKENS.ConfigService);
      const modelDownloadService = c.resolve<ModelDownloadService>(
        TOKENS.ModelDownloadService,
      );
      const appCfg = configService.getConfig();
      return makeEmbeddingProvider(appCfg.embedding, modelDownloadService);
    }),
  });
  di.register(TOKENS.ChunkingService, {
    useFactory: instanceCachingFactory((c) => {
      const appCfg = c.resolve<ConfigService>(TOKENS.ConfigService).getConfig();
      return createChunkingService(appCfg.indexing.chunking);
    }),
  });
  di.register(TOKENS.VectorRepository, {
    useFactory: instanceCachingFactory((c) => {
      const cfg = c.resolve<ConfigService>(TOKENS.ConfigService).getConfig();
      const embeddingDimension =
        cfg.embedding.provider === "local"
          ? cfg.embedding.local.dimension
          : cfg.embedding[cfg.embedding.provider].dimension;
      return createVectorRepository({
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
    }),
  });
  di.register(TOKENS.IndexMetadataRepository, {
    useFactory: instanceCachingFactory(() => {
      const created = createIndexMetadataRepository({
        dbPath: join(deps?.userDataDir ?? "build", "metadata", "index.db"),
      });
      metadataRepo = created;
      return created;
    }),
  });
  di.register(TOKENS.RetrievalService, {
    useFactory: instanceCachingFactory((c) => {
      const cfg = c.resolve<ConfigService>(TOKENS.ConfigService).getConfig();
      const embedding = c.resolve<EmbeddingProvider>(TOKENS.EmbeddingProvider);
      const vector = c.resolve<VectorRepository>(TOKENS.VectorRepository);
      const metadata = c.resolve<IndexMetadataRepository>(
        TOKENS.IndexMetadataRepository,
      );
      const logger = c.resolve<LoggerService>(TOKENS.LoggerService);
      const modelDownloadService = c.resolve<ModelDownloadService>(
        TOKENS.ModelDownloadService,
      );
      const reranker = createReranker(cfg.reranker, modelDownloadService);
      return createRetrievalService({
        embedding,
        vector,
        metadata,
        fts: metadata,
        sourceReader: {
          readRange(path: string, startOffset: number, endOffset: number) {
            const parser = resolveParser({
              ext: extname(path).toLowerCase(),
            });
            return parser.readRange(path, startOffset, endOffset);
          },
        },
        reranker: reranker ?? undefined,
        logger,
        defaults: {
          topK: cfg.retrieval.hybrid.vectorTopK,
          ftsTopN: cfg.retrieval.hybrid.ftsTopN,
        },
      });
    }),
  });
  di.register(TOKENS.IndexingService, {
    useFactory: instanceCachingFactory((c) =>
      createSourceIndexingService(
        c.resolve<ConfigService>(TOKENS.ConfigService),
        c.resolve<EmbeddingProvider>(TOKENS.EmbeddingProvider),
        c.resolve<ChunkingService>(TOKENS.ChunkingService),
        c.resolve<VectorRepository>(TOKENS.VectorRepository),
        c.resolve<LoggerService>(TOKENS.LoggerService),
        {
          metadata: c.resolve<IndexMetadataRepository>(
            TOKENS.IndexMetadataRepository,
          ),
        },
      ),
    ),
  });
  di.register(TOKENS.ModelDownloadService, {
    useFactory: instanceCachingFactory((c) =>
      createModelDownloadService(
        c.resolve<LoggerService>(TOKENS.LoggerService),
        c.resolve<ConfigService>(TOKENS.ConfigService),
      ),
    ),
  });
  di.register(TOKENS.ChatRepository, {
    useFactory: instanceCachingFactory(() => {
      const created = createChatRepository({
        dbPath: join(deps?.userDataDir ?? "build", "chat", "chat.db"),
      });
      chatRepo = created;
      return created;
    }),
  });
  di.register(TOKENS.ChatService, {
    useFactory: instanceCachingFactory((c) =>
      createChatService({
        config: c.resolve<ConfigService>(TOKENS.ConfigService),
        retrieval: c.resolve<RetrievalService>(TOKENS.RetrievalService),
        repository: c.resolve<ChatRepository>(TOKENS.ChatRepository),
      }),
    ),
  });
  di.register(TOKENS.VfsRepository, {
    useFactory: instanceCachingFactory(() => {
      const created = createVfsRepository({
        dbPath: join(deps?.userDataDir ?? "build", "metadata", "vfs.db"),
      });
      vfsRepo = created;
      return created;
    }),
  });
  di.register(TOKENS.VfsProviderRegistry, {
    useFactory: instanceCachingFactory(() => createVfsProviderRegistry()),
  });
  di.register(TOKENS.VfsService, {
    useFactory: instanceCachingFactory((c) =>
      createVfsService({
        repository: c.resolve<VfsRepository>(TOKENS.VfsRepository),
        registry: c.resolve<VfsProviderRegistry>(TOKENS.VfsProviderRegistry),
      }),
    ),
  });
  di.register(TOKENS.AppContainer, {
    useFactory: instanceCachingFactory((c) => {
      const configService = c.resolve<ConfigService>(TOKENS.ConfigService);
      const loggerService = c.resolve<LoggerService>(TOKENS.LoggerService);
      const vectorRepository = c.resolve<VectorRepository>(
        TOKENS.VectorRepository,
      );
      const retrievalService = c.resolve<RetrievalService>(
        TOKENS.RetrievalService,
      );
      const indexingService = c.resolve<IndexingService>(
        TOKENS.IndexingService,
      );
      const modelDownloadService = c.resolve<ModelDownloadService>(
        TOKENS.ModelDownloadService,
      );
      const chatService = c.resolve<ChatService>(TOKENS.ChatService);
      const vfsService = c.resolve<VfsService>(TOKENS.VfsService);

      const mcpServer = createMcpServer({
        retrieval: retrievalService,
        isEnabled: () => configService.getConfig().mcp.enabled,
      });

      return {
        configService,
        loggerService,
        vectorRepository,
        retrievalService,
        indexingService,
        modelDownloadService,
        chatService,
        vfsService,
        close: () => {
          metadataRepo?.close();
          chatRepo?.close();
          vfsRepo?.close();
        },
        mcpServer,
      } satisfies AppContainer;
    }),
  });
}
