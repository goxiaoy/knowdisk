import "reflect-metadata";
import { describe, expect, it, mock } from "bun:test";
import { createDefaultCoreConfig } from "@knowdisk/core";
import { container } from "tsyringe";
import { createQwenEmbeddingProvider } from "./qwen.embedding";

describe("qwen embedding provider", () => {
  it("throws a clear error when provider config is incomplete", () => {
    const config = createDefaultCoreConfig();
    config.providers.qwen = {
      endpoint: "",
      apiKey: "",
      embeddingModel: "",
    };

    container.clearInstances();
    container.registerInstance("CoreConfig", config);

    expect(() => createQwenEmbeddingProvider(container)).toThrow(
      'Qwen embedding provider requires "providers.qwen.endpoint"'
    );
  });

  it("calls the configured embeddings endpoint and returns the vector", async () => {
    const config = createDefaultCoreConfig();
    config.embedding.provider = "qwen";
    config.providers.qwen = {
      endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "secret",
      embeddingModel: "text-embedding-v4",
    };

    const fetchImpl = mock(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ embedding: [0.1, 0.2] }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );

    container.clearInstances();
    container.registerInstance("CoreConfig", config);
    container.registerInstance("fetch", fetchImpl);

    const provider = createQwenEmbeddingProvider(container);

    await expect(provider.embed("hello")).resolves.toEqual([0.1, 0.2]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(provider.type).toBe("qwen");
  });
});
