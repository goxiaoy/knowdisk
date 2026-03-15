import type {
  EmbeddingRegistry,
  IndexingService,
  RerankerRegistry,
} from "./indexing.types";

export function createIndexingService(): IndexingService {
  throw new Error("createIndexingService is not implemented");
}

export function createEmbeddingRegistry(): EmbeddingRegistry {
  throw new Error("createEmbeddingRegistry is not implemented");
}

export function createRerankerRegistry(): RerankerRegistry {
  throw new Error("createRerankerRegistry is not implemented");
}

export type * from "./indexing.types";
