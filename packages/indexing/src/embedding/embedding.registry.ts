import type { DependencyContainer } from "tsyringe";
import type { EmbeddingRegistry, EmbeddingFactory } from "../indexing.types";

export function createEmbeddingRegistry(container: DependencyContainer): EmbeddingRegistry {
  const factories = new Map<string, EmbeddingFactory>();

  return {
    register(providerType, factory) {
      factories.set(providerType, factory);
    },

    get(providerType, options) {
      const factory = factories.get(providerType);
      if (!factory) {
        throw new Error(`Unknown embedding provider type: "${providerType}"`);
      }
      return factory(container, options);
    },

    listTypes() {
      return [...factories.keys()].sort();
    },
  };
}
