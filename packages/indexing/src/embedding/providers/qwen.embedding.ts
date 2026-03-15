import type { CoreConfig } from "@knowdisk/core";
import type { DependencyContainer } from "tsyringe";
import type { EmbeddingProvider } from "../../indexing.types";

type QwenEmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
};

export function createQwenEmbeddingProvider(
  container: DependencyContainer,
): EmbeddingProvider {
  const config = container.resolve<CoreConfig>("CoreConfig");
  const fetchImpl = resolveFetch(container);
  const providerConfig = config.providers.qwen;

  if (!providerConfig?.endpoint) {
    throw new Error('Qwen embedding provider requires "providers.qwen.endpoint"');
  }
  if (!providerConfig.apiKey) {
    throw new Error('Qwen embedding provider requires "providers.qwen.apiKey"');
  }
  if (!providerConfig.embeddingModel) {
    throw new Error('Qwen embedding provider requires "providers.qwen.embeddingModel"');
  }

  return {
    type: "qwen",
    async embed(text) {
      const response = await fetchImpl(`${providerConfig.endpoint.replace(/\/+$/, "")}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${providerConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: providerConfig.embeddingModel,
          input: text,
        }),
      });
      if (!response.ok) {
        throw new Error(`Qwen embedding request failed: ${response.status} ${response.statusText}`);
      }
      const payload = (await response.json()) as QwenEmbeddingResponse;
      const embedding = payload.data?.[0]?.embedding;
      if (!embedding || embedding.length === 0) {
        throw new Error("Qwen embedding response did not include an embedding vector");
      }
      return embedding;
    },
  };
}

function resolveFetch(container: DependencyContainer): typeof fetch {
  try {
    return container.resolve<typeof fetch>("fetch");
  } catch {
    return fetch;
  }
}
