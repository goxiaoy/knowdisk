import { describe, expect, it } from "bun:test";
import { sep } from "node:path";
import { createDefaultCoreConfig } from "./index";

describe("createDefaultCoreConfig", () => {
  it("returns a package-scoped default config", () => {
    const config = createDefaultCoreConfig();

    expect(config.logger).toEqual({
      level: "info",
      name: "knowdisk",
    });
    expect(config.providers.huggingface?.endpoint).toBe("https://hf-mirror.com");
    expect(config.embedding.provider).toBe("local");
    expect(config.reranker.provider).toBe("local");
    expect(config.embedding.local?.model).toBe("Alibaba-NLP/gte-multilingual-base");
    expect(config.reranker.local?.model).toBe("Alibaba-NLP/gte-multilingual-reranker-base");
    expect(config.ocr.provider).toBe("local");
    expect(config.ocr.local?.model).toBe("PaddlePaddle/PaddleOCR-VL");
    expect(config.caption.provider).toBe("local");
    expect(config.caption.local?.model).toBe("vikhyatk/moondream2");
    expect(config.basePath.endsWith(`${sep}.knowdisk`)).toBe(true);
  });
});
