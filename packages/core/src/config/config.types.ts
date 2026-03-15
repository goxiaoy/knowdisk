export type OpenAiProviderConfig = {
  endpoint: string;
  apiKey: string;
  embeddingModel?: string;
  rerankModel?: string;
  chatModel?: string;
};

export type HuggingfaceProviderConfig = {
  endpoint: string;
};

export type QwenProviderConfig = {
  endpoint: string;
  apiKey: string;
  embeddingModel?: string;
  rerankModel?: string;
};

export type EmbeddingProviderId = "local" | "openai" | "qwen";
export type RerankerProviderId = "local" | "openai" | "qwen";
export type ChatProviderId = "openai";

export type CoreConfig = {
  logger: {
    level: string;
    name: string;
  };
  providers: {
    openai?: OpenAiProviderConfig;
    huggingface?: HuggingfaceProviderConfig;
    qwen?: QwenProviderConfig;
  };
  embedding: {
    provider: EmbeddingProviderId;
    local?: {
      model: string;
      dimension: number;
    };
  };
  reranker: {
    enabled: boolean;
    provider: RerankerProviderId;
    local?: {
      model: string;
      topN: number;
    };
  };
  chat?: {
    provider: ChatProviderId;
  };
};
