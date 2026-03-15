import type { DependencyContainer } from "tsyringe";

export function registerBuiltInProviders(
  _container: DependencyContainer,
  _input: {
    embeddingRegistry: { register: (providerType: string, factory: unknown) => void };
    rerankerRegistry: { register: (providerType: string, factory: unknown) => void };
  },
) {}
