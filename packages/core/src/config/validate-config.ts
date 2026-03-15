import type { CoreConfig, OpenAiProviderConfig, QwenProviderConfig } from "./config.types";

export function validateCoreConfig(
  config: CoreConfig,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.logger.name.trim().length === 0) {
    errors.push("logger.name is required");
  }
  if (config.logger.level.trim().length === 0) {
    errors.push("logger.level is required");
  }

  if (config.embedding.provider === "local") {
    if (!config.embedding.local) {
      errors.push("embedding.local is required for embedding.provider=local");
    } else if (config.embedding.local.dimension <= 0) {
      errors.push("embedding.local.dimension must be > 0");
    }
  }

  if (config.embedding.provider === "openai") {
    validateOpenAiProvider(errors, config.providers.openai, "embedding.provider=openai");
  }

  if (config.embedding.provider === "qwen") {
    validateQwenProvider(errors, config.providers.qwen, "embedding.provider=qwen");
  }

  if (config.reranker.provider === "local") {
    if (!config.reranker.local) {
      errors.push("reranker.local is required for reranker.provider=local");
    } else if (config.reranker.local.topN <= 0) {
      errors.push("reranker.local.topN must be > 0");
    }
  }

  if (config.reranker.provider === "openai") {
    validateOpenAiProvider(errors, config.providers.openai, "reranker.provider=openai");
  }

  if (config.reranker.provider === "qwen") {
    validateQwenProvider(errors, config.providers.qwen, "reranker.provider=qwen");
  }

  if (config.chat?.provider === "openai") {
    if (!config.providers.openai || config.providers.openai.endpoint.trim().length === 0) {
      errors.push("providers.openai.endpoint is required for chat.provider=openai");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function validateOpenAiProvider(
  errors: string[],
  config: OpenAiProviderConfig | undefined,
  consumer: string,
) {
  if (!config || config.endpoint.trim().length === 0) {
    errors.push(`providers.openai.endpoint is required for ${consumer}`);
  }
  if (!config || config.apiKey.trim().length === 0) {
    errors.push(`providers.openai.apiKey is required for ${consumer}`);
  }
}

function validateQwenProvider(
  errors: string[],
  config: QwenProviderConfig | undefined,
  consumer: string,
) {
  if (!config || config.endpoint.trim().length === 0) {
    errors.push(`providers.qwen.endpoint is required for ${consumer}`);
  }
  if (!config || config.apiKey.trim().length === 0) {
    errors.push(`providers.qwen.apiKey is required for ${consumer}`);
  }
}
