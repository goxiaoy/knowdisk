import { describe, expect, it } from "bun:test";
import { createDefaultCoreConfig, validateCoreConfig } from "./index";

describe("validateCoreConfig", () => {
  it("accepts the default config", () => {
    expect(validateCoreConfig(createDefaultCoreConfig())).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("requires openai credentials when openai embedding is selected", () => {
    const config = createDefaultCoreConfig();
    config.embedding.provider = "openai";
    config.providers.openai = {
      endpoint: "https://api.openai.com",
      apiKey: "",
    };

    expect(validateCoreConfig(config)).toEqual({
      ok: false,
      errors: ["providers.openai.apiKey is required for embedding.provider=openai"],
    });
  });

  it("requires qwen endpoint and key when qwen reranker is selected", () => {
    const config = createDefaultCoreConfig();
    config.reranker.provider = "qwen";
    config.providers.qwen = {
      endpoint: "",
      apiKey: "",
    };

    expect(validateCoreConfig(config)).toEqual({
      ok: false,
      errors: [
        "providers.qwen.endpoint is required for reranker.provider=qwen",
        "providers.qwen.apiKey is required for reranker.provider=qwen",
      ],
    });
  });

  it("requires local embedding settings for local provider", () => {
    const config = createDefaultCoreConfig();
    config.embedding.local = undefined;

    expect(validateCoreConfig(config)).toEqual({
      ok: false,
      errors: ["embedding.local is required for embedding.provider=local"],
    });
  });

  it("requires basePath", () => {
    const config = createDefaultCoreConfig();
    config.basePath = "   ";

    expect(validateCoreConfig(config)).toEqual({
      ok: false,
      errors: ["basePath is required"],
    });
  });
});
