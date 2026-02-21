import { expect, test } from "bun:test";
import { makeEmbeddingProvider } from "./embedding.service";

test("uses configured local provider", async () => {
  const provider = makeEmbeddingProvider({
    provider: "local",
    apiKeys: {},
    endpoint: "",
    hfEndpoint: "https://hf-mirror.com",
    dimension: 16,
  }, {
    createExtractor: async () => {
      return async () => ({ data: new Float32Array([0.1, 0.2, 0.3]) });
    },
  });
  const vec = await provider.embed("hello");
  expect(Array.isArray(vec)).toBe(true);
  expect(vec.length).toBe(3);
});

test("changes vector output for different provider settings", async () => {
  const a = makeEmbeddingProvider({
    provider: "local",
    apiKeys: {},
    endpoint: "",
    hfEndpoint: "https://hf-mirror.com",
    dimension: 8,
  }, {
    createExtractor: async () => async (text) => ({ data: new Float32Array([text.length, 1]) }),
  });
  const b = makeEmbeddingProvider({
    provider: "local",
    apiKeys: {},
    endpoint: "https://example.local",
    hfEndpoint: "https://another-hf-mirror.com",
    dimension: 8,
  }, {
    createExtractor: async () => async (text) => ({ data: new Float32Array([text.length, 2]) }),
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
      hfEndpoint: "https://hf-mirror.com",
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
      hfEndpoint: "https://hf-mirror.com",
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
