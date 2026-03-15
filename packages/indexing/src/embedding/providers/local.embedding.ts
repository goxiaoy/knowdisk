import type { DependencyContainer } from "tsyringe";
import type { EmbeddingProvider } from "../../indexing.types";

export function createLocalEmbeddingProvider(
  container: DependencyContainer,
  options?: Record<string, unknown>,
): EmbeddingProvider {
  const modelService = resolveModelService(container);

  return {
    type: "local",
    dimension:
      typeof options?.dimension === "number" ? options.dimension : undefined,
    async embed(text) {
      const extractor = await modelService.getLocalEmbeddingExtractor();
      const result = await extractor(text, {
        pooling: "mean",
        normalize: true,
      });
      return result.data ? Array.from(result.data) : [];
    },
  };
}

function resolveModelService(container: DependencyContainer) {
  try {
    return container.resolve<{
      getLocalEmbeddingExtractor: () => Promise<
        (text: string, opts: { pooling: "mean"; normalize: true }) => Promise<{ data?: ArrayLike<number> }>
      >;
    }>("ModelService");
  } catch {
    throw new Error('Local embedding provider requires "ModelService"');
  }
}
