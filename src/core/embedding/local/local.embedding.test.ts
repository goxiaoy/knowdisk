import { expect, test } from "bun:test";
import { embedWithLocalProvider } from "./local.embedding";
import type { EmbeddingConfig } from "../embedding.types";

function makeLocalConfig(overrides?: Partial<EmbeddingConfig["local"]>): EmbeddingConfig {
  return {
    provider: "local",
    local: {
      hfEndpoint: "https://hf-mirror.com",
      cacheDir: "build/cache/embedding/local",
      model: "Xenova/all-MiniLM-L6-v2",
      dimension: 384,
      ...overrides,
    },
    qwen_dense: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
    qwen_sparse: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
    openai_dense: { apiKey: "", model: "text-embedding-3-small", dimension: 1536 },
  };
}

test("embeds using local extractor output", async () => {
  const cfg = makeLocalConfig({ cacheDir: "build/cache/embedding/local-a", model: "model-a" });
  const vector = await embedWithLocalProvider(
    cfg,
    "hello",
    async () => async () => ({ data: new Float32Array([0.1, 0.2, 0.3]) }),
  );
  expect(vector).toHaveLength(3);
  expect(vector[0]).toBeCloseTo(0.1, 6);
  expect(vector[1]).toBeCloseTo(0.2, 6);
  expect(vector[2]).toBeCloseTo(0.3, 6);
});

test("throws when local extractor returns missing data", async () => {
  const cfg = makeLocalConfig({ cacheDir: "build/cache/embedding/local-b", model: "model-b" });
  await expect(
    embedWithLocalProvider(
      cfg,
      "hello",
      async () => async () => ({}),
    ),
  ).rejects.toThrow("local embedding output missing data");
});
