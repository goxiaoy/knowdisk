import { describe, expect, it } from "bun:test";
import * as configModule from "./index";
import type { CoreConfig } from "./index";

describe("CoreConfig", () => {
  it("supports provider selection separately from provider settings", () => {
    const config: CoreConfig = {
      basePath: "/tmp/.knowdisk",
      logger: { level: "info", name: "knowdisk" },
      providers: {
        openai: {
          endpoint: "https://api.openai.com",
          apiKey: "secret",
          embeddingModel: "text-embedding-3-small",
        },
        huggingface: {
          endpoint: "https://hf-mirror.com",
        },
      },
      embedding: {
        provider: "openai",
      },
      reranker: {
        enabled: false,
        provider: "local",
        local: { model: "Xenova/bge-reranker-base", topN: 5 },
      },
      chat: {
        provider: "openai",
      },
    };

    expect(config.providers.openai?.endpoint).toBe("https://api.openai.com");
    expect(config.embedding.provider).toBe("openai");
    expect(config.basePath).toBe("/tmp/.knowdisk");
    expect(configModule).toBeObject();
  });
});
