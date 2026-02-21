import { defaultConfigService, type ConfigService } from "../core/config/config.service";
import { makeEmbeddingProvider } from "../core/embedding/embedding.service";
import { createHealthService } from "../core/health/health.service";
import { createMcpServer } from "../core/mcp/mcp.server";
import { createRetrievalService } from "../core/retrieval/retrieval.service";
import { createVectorRepository } from "../core/vector/vector.repository";

type RetrievalService = {
  search: (query: string, opts: { topK?: number }) => Promise<unknown[]>;
};

type HealthService = ReturnType<typeof createHealthService>;

export type AppContainer = {
  configService: ConfigService;
  healthService: HealthService;
  retrievalService: RetrievalService;
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
            chunkText: "",
            updatedAt: "",
          },
        }));
      },
    },
    defaults: { topK: 5 },
  });

  if (!configService.getMcpEnabled()) {
    return {
      configService,
      healthService,
      retrievalService,
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
    mcpServer,
  };
}
