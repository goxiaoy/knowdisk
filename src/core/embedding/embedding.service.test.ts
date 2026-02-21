import { expect, test } from "bun:test";
import { makeEmbeddingProvider } from "./embedding.service";

test("uses configured local provider", async () => {
  const provider = makeEmbeddingProvider({
    provider: "local",
    apiKeys: {},
    endpoint: "",
    dimension: 16,
  });
  const vec = await provider.embed("hello");
  expect(Array.isArray(vec)).toBe(true);
  expect(vec.length).toBe(16);
});

test("changes vector output for different provider settings", async () => {
  const a = makeEmbeddingProvider({
    provider: "local",
    apiKeys: {},
    endpoint: "",
    dimension: 8,
  });
  const b = makeEmbeddingProvider({
    provider: "local",
    apiKeys: {},
    endpoint: "https://example.local",
    dimension: 8,
  });
  const [va, vb] = await Promise.all([a.embed("hello"), b.embed("hello")]);
  expect(va).not.toEqual(vb);
});

test("uses openai dense embedding when cloud provider is configured", async () => {
  const provider = makeEmbeddingProvider(
    {
      provider: "openai_dense",
      endpoint: "https://api.openai.com/v1/embeddings",
      apiKeys: { openai_dense: "sk-test" },
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
      provider: "qwen_sparse",
      endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/embeddings",
      apiKeys: { qwen_sparse: "sk-test" },
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
