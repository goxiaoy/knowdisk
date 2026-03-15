import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { container as rootContainer } from "tsyringe";
import { createRerankerRegistry } from "./reranker.registry";
import type { RerankerProvider, SearchHit } from "../indexing.types";

describe("reranker registry", () => {
  test("register/get/listTypes", async () => {
    const registry = createRerankerRegistry(rootContainer.createChildContainer());
    registry.register("stub", () => createReranker("stub"));

    const provider = registry.get("stub");

    expect(provider.type).toBe("stub");
    expect(await provider.rerank("q", [createHit()], { topK: 1 })).toHaveLength(1);
    expect(registry.listTypes()).toEqual(["stub"]);
  });

  test("throws clear error for unknown type", () => {
    const registry = createRerankerRegistry(rootContainer.createChildContainer());

    expect(() => registry.get("missing")).toThrow(
      'Unknown reranker provider type: "missing"',
    );
  });

  test("factory returns reranker implementation", async () => {
    const registry = createRerankerRegistry(rootContainer.createChildContainer());
    registry.register("reverse", () => ({
      type: "reverse",
      async rerank(_query, rows, opts) {
        return rows.slice(0, opts.topK).reverse();
      },
    }));

    const result = await registry.get("reverse").rerank(
      "q",
      [createHit("a"), createHit("b")],
      { topK: 2 },
    );

    expect(result.map((item) => item.chunkId)).toEqual(["b", "a"]);
  });
});

function createReranker(type: string): RerankerProvider {
  return {
    type,
    async rerank(_query, rows, opts) {
      return rows.slice(0, opts.topK);
    },
  };
}

function createHit(chunkId = "chunk-1"): SearchHit {
  return {
    chunkId,
    nodeId: "node-1",
    mountId: "mount-1",
    sourceRef: "docs/readme.md",
    name: "readme.md",
    title: "Readme",
    heading: "Overview",
    text: "Knowdisk overview",
    chunkIndex: 0,
    sectionPath: ["Overview"],
    charStart: 0,
    charEnd: 17,
    score: 0.9,
    scores: {
      fused: 0.9,
    },
  };
}
