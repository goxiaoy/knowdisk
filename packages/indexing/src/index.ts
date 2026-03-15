import type { IndexingService, RerankerRegistry } from "./indexing.types";

export function createIndexingService(): IndexingService {
  throw new Error("createIndexingService is not implemented");
}

export function createRerankerRegistry(): RerankerRegistry {
  throw new Error("createRerankerRegistry is not implemented");
}

export { createEmbeddingRegistry } from "./embedding.registry";
export type * from "./indexing.types";
