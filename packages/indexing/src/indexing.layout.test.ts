import { describe, expect, it } from "bun:test";
import { createEmbeddingRegistry } from "./embedding";
import { createRerankerRegistry } from "./rerank";
import { createFtsRepository } from "./fts";
import { createVectorRepository } from "./vector";

describe("indexing internal layout", () => {
  it("exposes feature entrypoints from grouped folders", () => {
    expect(createEmbeddingRegistry).toBeFunction();
    expect(createRerankerRegistry).toBeFunction();
    expect(createFtsRepository).toBeFunction();
    expect(createVectorRepository).toBeFunction();
  });
});
