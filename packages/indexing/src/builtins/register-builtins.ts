import type { DependencyContainer } from "tsyringe";
import { createLocalEmbeddingProvider } from "../embedding/providers/local.embedding";
import { createOpenAiEmbeddingProvider } from "../embedding/providers/openai.embedding";
import { createQwenEmbeddingProvider } from "../embedding/providers/qwen.embedding";
import { createLocalRerankerProvider } from "../rerank/providers/local.reranker";

export function registerBuiltInProviders(
  container: DependencyContainer,
  input: {
    embeddingRegistry: {
      register: (
        providerType: string,
        factory: (container: DependencyContainer, options?: Record<string, unknown>) => unknown
      ) => void;
    };
    rerankerRegistry: {
      register: (
        providerType: string,
        factory: (container: DependencyContainer, options?: Record<string, unknown>) => unknown
      ) => void;
    };
  }
) {
  input.embeddingRegistry.register("local", createLocalEmbeddingProvider);
  input.embeddingRegistry.register("openai", () => createOpenAiEmbeddingProvider(container));
  input.embeddingRegistry.register("qwen", () => createQwenEmbeddingProvider(container));
  input.rerankerRegistry.register("local", () => createLocalRerankerProvider(container));
}
