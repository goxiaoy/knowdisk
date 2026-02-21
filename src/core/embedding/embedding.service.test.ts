import { expect, test } from "bun:test";
import { makeEmbeddingProvider } from "./embedding.service";

test("uses configured local provider", async () => {
  const provider = makeEmbeddingProvider({
    mode: "local",
    provider: "local",
    model: "BAAI/bge-small-en-v1.5",
    apiKeys: {},
    endpoint: "",
    dimension: 16,
  });
  const vec = await provider.embed("hello");
  expect(Array.isArray(vec)).toBe(true);
  expect(vec.length).toBe(16);
});

test("changes vector output for different model", async () => {
  const a = makeEmbeddingProvider({
    mode: "local",
    provider: "local",
    model: "BAAI/bge-small-en-v1.5",
    apiKeys: {},
    endpoint: "",
    dimension: 8,
  });
  const b = makeEmbeddingProvider({
    mode: "local",
    provider: "local",
    model: "BAAI/bge-base-en-v1.5",
    apiKeys: {},
    endpoint: "",
    dimension: 8,
  });
  const [va, vb] = await Promise.all([a.embed("hello"), b.embed("hello")]);
  expect(va).not.toEqual(vb);
});

test("uses openai dense embedding when cloud provider is configured", async () => {
  const provider = makeEmbeddingProvider(
    {
      mode: "cloud",
      provider: "openai_dense",
      model: "text-embedding-3-small",
      endpoint: "https://api.openai.com/v1/embeddings",
      apiKeys: { "openai_dense:text-embedding-3-small": "sk-test" },
      dimension: 3,
    },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [{ embedding: [0.1, 0.2, 0.3] }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    },
  );
  const vec = await provider.embed("hello");
  expect(vec).toEqual([0.1, 0.2, 0.3]);
});

test("supports qwen sparse embedding response", async () => {
  const provider = makeEmbeddingProvider(
    {
      mode: "cloud",
      provider: "qwen_sparse",
      model: "text-embedding-v4",
      endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/embeddings",
      apiKeys: { "qwen_sparse:text-embedding-v4": "sk-test" },
      dimension: 4,
    },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [{ embedding: { "0": 0.5, "2": 0.25 } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    },
  );
  const vec = await provider.embed("hello");
  expect(vec).toEqual([0.5, 0, 0.25, 0]);
});
