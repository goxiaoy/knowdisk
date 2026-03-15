import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { container } from "tsyringe";
import { createEmbeddingRegistry, createRerankerRegistry } from "../index";
import { registerBuiltInProviders } from "./register-builtins";

describe("registerBuiltInProviders", () => {
  it("registers local, openai, and qwen embedding providers and local reranker", () => {
    const embeddingRegistry = createEmbeddingRegistry(container);
    const rerankerRegistry = createRerankerRegistry(container);

    registerBuiltInProviders(container, {
      embeddingRegistry,
      rerankerRegistry,
    });

    expect(embeddingRegistry.listTypes()).toEqual(["local", "openai", "qwen"]);
    expect(rerankerRegistry.listTypes()).toEqual(["local"]);
  });
});
