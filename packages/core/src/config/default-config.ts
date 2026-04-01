import { homedir } from "node:os";
import { join } from "node:path";
import type { CoreConfig } from "./config.types";

export function createDefaultCoreConfig(): CoreConfig {
  return {
    basePath: join(homedir(), ".knowdisk"),
    logger: {
      level: "info",
      name: "knowdisk",
    },
    providers: {
      openai: {
        endpoint: "https://api.openai.com",
        apiKey: "",
      },
      huggingface: {
        endpoint: "https://huggingface.co",
      },
      qwen: {
        endpoint: "",
        apiKey: "",
      },
    },
    embedding: {
      provider: "local",
      local: {
        model: "Alibaba-NLP/gte-multilingual-base",
        dimension: 768,
      },
    },
    reranker: {
      enabled: true,
      provider: "local",
      local: {
        model: "Alibaba-NLP/gte-multilingual-reranker-base",
        topN: 5,
      },
    },
    ocr: {
      provider: "local",
      local: {
        model: "PaddlePaddle/PP-OCRv4_mobile",
        enableTableRecognition: false,
        enableFormulaRecognition: false,
      },
    },
    caption: {
      provider: "local",
      local: {
        model: "vikhyatk/moondream2",
      },
    },
    chat: {
      provider: "openai",
    },
  };
}
