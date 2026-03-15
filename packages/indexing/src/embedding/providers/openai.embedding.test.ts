import "reflect-metadata";
import { describe, expect, it, mock } from "bun:test";
import { createDefaultCoreConfig } from "@knowdisk/core";
import { container } from "tsyringe";
import { createOpenAiEmbeddingProvider } from "./openai.embedding";

describe("openai embedding provider", () => {
  it("calls the configured embeddings endpoint and returns the vector", async () => {
    const config = createDefaultCoreConfig();
    config.embedding.provider = "openai";
    config.providers.openai = {
      endpoint: "https://api.openai.com",
      apiKey: "secret",
      embeddingModel: "text-embedding-3-small",
    };

    const fetchImpl = mock(async () =>
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    container.clearInstances();
    container.registerInstance("CoreConfig", config);
    container.registerInstance("fetch", fetchImpl);

    const provider = createOpenAiEmbeddingProvider(container);

    await expect(provider.embed("hello")).resolves.toEqual([0.1, 0.2]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(provider.type).toBe("openai");
  });
});
