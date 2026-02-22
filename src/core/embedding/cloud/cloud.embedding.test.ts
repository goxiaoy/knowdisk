import { expect, test } from "bun:test";
import { embedWithCloudProvider } from "./cloud.embedding";
import type { EmbeddingConfig } from "../embedding.types";

function makeCloudConfig(
  provider: "openai_dense" | "qwen_dense" | "qwen_sparse",
  apiKey: string,
  dimension: number,
): EmbeddingConfig {
  return {
    provider,
    local: {
      hfEndpoint: "https://hf-mirror.com",
      cacheDir: "build/cache/embedding/local",
      model: "Xenova/all-MiniLM-L6-v2",
      dimension: 384,
    },
    qwen_dense: { apiKey: provider === "qwen_dense" ? apiKey : "", model: "text-embedding-v4", dimension },
    qwen_sparse: { apiKey: provider === "qwen_sparse" ? apiKey : "", model: "text-embedding-v4", dimension },
    openai_dense: { apiKey: provider === "openai_dense" ? apiKey : "", model: "text-embedding-3-small", dimension },
  };
}

test("uses openai dense embedding response", async () => {
  const cfg = makeCloudConfig("openai_dense", "sk-test", 3);
  const vec = await embedWithCloudProvider(
    cfg,
    "hello",
    async () =>
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  expect(vec).toEqual([0.1, 0.2, 0.3]);
});

test("supports qwen sparse object embedding response", async () => {
  const cfg = makeCloudConfig("qwen_sparse", "qwen-test", 4);
  const vec = await embedWithCloudProvider(
    cfg,
    "hello",
    async () =>
      new Response(
        JSON.stringify({
          data: [{ embedding: { "0": 0.5, "2": 0.25 } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  expect(vec).toEqual([0.5, 0, 0.25, 0]);
});

test("fails when cloud apiKey is missing", async () => {
  const cfg = makeCloudConfig("openai_dense", "", 3);
  await expect(
    embedWithCloudProvider(cfg, "hello", async () => new Response("{}", { status: 200 })),
  ).rejects.toThrow("cloud embedding requires apiKey");
});

