import { expect, test } from "bun:test";
import { makeEmbeddingProvider } from "./embedding.service";

test("uses configured local provider", async () => {
  const provider = makeEmbeddingProvider({
    mode: "local",
    model: "BAAI/bge-small-en-v1.5",
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
    model: "BAAI/bge-small-en-v1.5",
    endpoint: "",
    dimension: 8,
  });
  const b = makeEmbeddingProvider({
    mode: "local",
    model: "BAAI/bge-base-en-v1.5",
    endpoint: "",
    dimension: 8,
  });
  const [va, vb] = await Promise.all([a.embed("hello"), b.embed("hello")]);
  expect(va).not.toEqual(vb);
});
