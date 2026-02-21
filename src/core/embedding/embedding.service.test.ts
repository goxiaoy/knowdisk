import { expect, test } from "bun:test";
import { makeEmbeddingProvider } from "./embedding.service";

test("uses configured local provider", async () => {
  const provider = makeEmbeddingProvider(
    {
      provider: "local",
      local: {
        hfEndpoint: "https://hf-mirror.com",
        cacheDir: "build/cache/embedding/local",
        model: "Xenova/all-MiniLM-L6-v2",
        dimension: 384,
      },
      qwen_dense: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
      qwen_sparse: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
      openai_dense: { apiKey: "", model: "text-embedding-3-small", dimension: 1536 },
    },
    {
      createExtractor: async () => {
        return async () => ({ data: new Float32Array([0.1, 0.2, 0.3]) });
      },
    },
  );
  const vec = await provider.embed("hello");
  expect(Array.isArray(vec)).toBe(true);
  expect(vec.length).toBe(3);
});

test("changes vector output for different local model", async () => {
  const a = makeEmbeddingProvider(
    {
      provider: "local",
      local: {
        hfEndpoint: "https://hf-mirror.com",
        cacheDir: "build/cache/embedding/a",
        model: "model-a",
        dimension: 384,
      },
      qwen_dense: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
      qwen_sparse: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
      openai_dense: { apiKey: "", model: "text-embedding-3-small", dimension: 1536 },
    },
    {
      createExtractor: async (_model) => async (text) => ({ data: new Float32Array([text.length, 1]) }),
    },
  );
  const b = makeEmbeddingProvider(
    {
      provider: "local",
      local: {
        hfEndpoint: "https://hf-mirror.com",
        cacheDir: "build/cache/embedding/b",
        model: "model-b",
        dimension: 384,
      },
      qwen_dense: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
      qwen_sparse: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
      openai_dense: { apiKey: "", model: "text-embedding-3-small", dimension: 1536 },
    },
    {
      createExtractor: async (_model) => async (text) => ({ data: new Float32Array([text.length, 2]) }),
    },
  );
  const [va, vb] = await Promise.all([a.embed("hello"), b.embed("hello")]);
  expect(va).not.toEqual(vb);
});

test("uses openai dense embedding when cloud provider is configured", async () => {
  const provider = makeEmbeddingProvider(
    {
      provider: "openai_dense",
      local: {
        hfEndpoint: "https://hf-mirror.com",
        cacheDir: "build/cache/embedding/local",
        model: "Xenova/all-MiniLM-L6-v2",
        dimension: 384,
      },
      qwen_dense: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
      qwen_sparse: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
      openai_dense: { apiKey: "sk-test", model: "text-embedding-3-small", dimension: 3 },
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
      local: {
        hfEndpoint: "https://hf-mirror.com",
        cacheDir: "build/cache/embedding/local",
        model: "Xenova/all-MiniLM-L6-v2",
        dimension: 384,
      },
      qwen_dense: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
      qwen_sparse: { apiKey: "qwen-test", model: "text-embedding-v4", dimension: 4 },
      openai_dense: { apiKey: "", model: "text-embedding-3-small", dimension: 1536 },
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
