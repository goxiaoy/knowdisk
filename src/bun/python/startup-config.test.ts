import { describe, expect, test } from "bun:test";
import { createDefaultCoreConfig } from "@knowdisk/core";
import {
  createPythonWorkerCoreConfigSubset,
  createPythonWorkerStartupConfig,
} from "./startup-config";

describe("createPythonWorkerStartupConfig", () => {
  test("derives python startup settings from core config", () => {
    const config = createDefaultCoreConfig();

    expect(
      createPythonWorkerStartupConfig({
        config,
        preferredDevice: "cpu",
      })
    ).toEqual({
      basePath: config.basePath,
      embeddingModel: "Alibaba-NLP/gte-multilingual-base",
      rerankerModel: "Alibaba-NLP/gte-multilingual-reranker-base",
      preferredDevice: "cpu",
      huggingfaceEndpoint: "https://huggingface.co",
      coreConfig: createPythonWorkerCoreConfigSubset(config),
    });
  });

  test("requires local embedding and reranker providers", () => {
    const config = createDefaultCoreConfig();
    config.embedding.provider = "openai";
    config.embedding.local = undefined;

    expect(() =>
      createPythonWorkerStartupConfig({
        config,
        preferredDevice: "cpu",
      })
    ).toThrow("python worker requires embedding.provider=local");
  });
});
