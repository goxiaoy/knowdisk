import type { CoreConfig } from "@knowdisk/core";
import type { DependencyContainer } from "tsyringe";
import { createEmbeddingRegistry } from "../embedding";
import { createIndexingService } from "../indexing.service";
import { createRerankerRegistry } from "../rerank";
import { registerBuiltInProviders } from "./register-builtins";

export function createIndexingServiceFromConfig(
  container: DependencyContainer,
  input: {
    logger: Parameters<typeof createIndexingService>[0]["logger"];
    ftsRepository: Parameters<typeof createIndexingService>[0]["ftsRepository"];
    vectorRepository: Parameters<typeof createIndexingService>[0]["vectorRepository"];
    defaults?: Parameters<typeof createIndexingService>[0]["defaults"];
  }
) {
  const config = container.resolve<CoreConfig>("CoreConfig");
  const embeddingRegistry = createEmbeddingRegistry(container);
  const rerankerRegistry = createRerankerRegistry(container);

  registerBuiltInProviders(container, {
    embeddingRegistry,
    rerankerRegistry,
  });

  return createIndexingService({
    logger: input.logger,
    ftsRepository: input.ftsRepository,
    vectorRepository: input.vectorRepository,
    embeddingRegistry,
    rerankerRegistry,
    embedding: {
      type: config.embedding.provider,
      options:
        config.embedding.provider === "local"
          ? { dimension: config.embedding.local?.dimension }
          : undefined,
    },
    reranker:
      config.reranker.enabled && config.reranker.provider === "local" ? { type: "local" } : null,
    defaults: input.defaults,
  });
}
