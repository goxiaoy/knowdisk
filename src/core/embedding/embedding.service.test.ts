import { expect, test } from "bun:test";
import { makeEmbeddingProvider } from "./embedding.service";

test("uses configured local provider", async () => {
  const provider = makeEmbeddingProvider({ mode: "local", model: "bge-small" });
  const vec = await provider.embed("hello");
  expect(Array.isArray(vec)).toBe(true);
  expect(vec.length).toBeGreaterThan(0);
});
