import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { container as rootContainer } from "tsyringe";
import { createEmbeddingRegistry } from "./embedding.registry";
import type { EmbeddingProvider } from "../indexing.types";

describe("embedding registry", () => {
  test("register/get/listTypes", async () => {
    const registry = createEmbeddingRegistry(rootContainer.createChildContainer());
    registry.register("stub", () => createEmbedding("stub"));

    const provider = registry.get("stub");

    expect(provider.type).toBe("stub");
    expect(await provider.embed("abc")).toEqual([3, 0, 0]);
    expect(registry.listTypes()).toEqual(["stub"]);
  });

  test("duplicate type registration overwrites prior factory", async () => {
    const registry = createEmbeddingRegistry(rootContainer.createChildContainer());
    registry.register("stub", () => createEmbedding("first"));
    registry.register("stub", () => createEmbedding("second"));

    expect(registry.get("stub").type).toBe("second");
  });

  test("throws clear error for unknown type", () => {
    const registry = createEmbeddingRegistry(rootContainer.createChildContainer());

    expect(() => registry.get("missing")).toThrow(
      'Unknown embedding provider type: "missing"',
    );
  });

  test("passes container and options into the factory", async () => {
    const child = rootContainer.createChildContainer();
    child.register("embedding-salt", {
      useValue: "salt-1",
    });
    const registry = createEmbeddingRegistry(child);
    registry.register("stub", (container, options) => ({
      type: `${container.resolve<string>("embedding-salt")}:${String(options?.suffix)}`,
      async embed(text) {
        return [text.length, Number(options?.flag ?? 0)];
      },
    }));

    const provider = registry.get("stub", {
      suffix: "v1",
      flag: 1,
    });

    expect(provider.type).toBe("salt-1:v1");
    expect(await provider.embed("abc")).toEqual([3, 1]);
  });
});

function createEmbedding(type: string): EmbeddingProvider {
  return {
    type,
    async embed(text) {
      return [text.length, 0, 0];
    },
  };
}
