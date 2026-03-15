import type { DependencyContainer } from "tsyringe";
import type { RerankerFactory, RerankerRegistry } from "../indexing.types";

export function createRerankerRegistry(container: DependencyContainer): RerankerRegistry {
  const factories = new Map<string, RerankerFactory>();

  return {
    register(providerType, factory) {
      factories.set(providerType, factory);
    },

    get(providerType, options) {
      const factory = factories.get(providerType);
      if (!factory) {
        throw new Error(`Unknown reranker provider type: "${providerType}"`);
      }
      return factory(container, options);
    },

    listTypes() {
      return [...factories.keys()].sort();
    },
  };
}
