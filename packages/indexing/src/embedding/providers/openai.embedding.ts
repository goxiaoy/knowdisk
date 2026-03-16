import type { CoreConfig } from "@knowdisk/core";
import type { DependencyContainer } from "tsyringe";
import type { EmbeddingProvider } from "../../indexing.types";

type OpenAiEmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
};

export function createOpenAiEmbeddingProvider(container: DependencyContainer): EmbeddingProvider {
  const config = container.resolve<CoreConfig>("CoreConfig");
  const fetchImpl = resolveFetch(container);
  const providerConfig = config.providers.openai;

  if (!providerConfig?.endpoint) {
    throw new Error('OpenAI embedding provider requires "providers.openai.endpoint"');
  }
  if (!providerConfig.apiKey) {
    throw new Error('OpenAI embedding provider requires "providers.openai.apiKey"');
  }
  if (!providerConfig.embeddingModel) {
    throw new Error('OpenAI embedding provider requires "providers.openai.embeddingModel"');
  }

  return {
    type: "openai",
    async embed(text) {
      const response = await fetchImpl(
        `${providerConfig.endpoint.replace(/\/+$/, "")}/embeddings`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${providerConfig.apiKey}`,
          },
          body: JSON.stringify({
            model: providerConfig.embeddingModel,
            input: text,
          }),
        }
      );
      if (!response.ok) {
        throw new Error(
          `OpenAI embedding request failed: ${response.status} ${response.statusText}`
        );
      }
      const payload = (await response.json()) as OpenAiEmbeddingResponse;
      const embedding = payload.data?.[0]?.embedding;
      if (!embedding || embedding.length === 0) {
        throw new Error("OpenAI embedding response did not include an embedding vector");
      }
      return embedding;
    },
  };
}

function resolveFetch(container: DependencyContainer): typeof fetch {
  try {
    return container.resolve<typeof fetch>("Fetch");
  } catch {
    // fall through to legacy token and global fetch
  }
  try {
    return container.resolve<typeof fetch>("fetch");
  } catch {
    return fetch;
  }
}
