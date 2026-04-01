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
          endpoint: "https://huggingface.co",
        },
      },
      embedding: {
        provider: "openai",
      },
      reranker: {
        enabled: false,
        provider: "local",
        local: { model: "Alibaba-NLP/gte-multilingual-reranker-base", topN: 5 },
      },
      ocr: {
        provider: "local",
        local: {
          model: "PaddlePaddle/PP-OCRv4_mobile",
          enableTableRecognition: true,
          enableFormulaRecognition: false,
        },
      },
      caption: {
        provider: "local",
        local: { model: "vikhyatk/moondream2" },
      },
      chat: {
        provider: "openai",
      },
    };

    expect(config.providers.openai?.endpoint).toBe("https://api.openai.com");
    expect(config.embedding.provider).toBe("openai");
    expect(config.basePath).toBe("/tmp/.knowdisk");
    expect(config.ocr.local?.enableTableRecognition).toBe(true);
    expect(configModule).toBeObject();
  });
});
