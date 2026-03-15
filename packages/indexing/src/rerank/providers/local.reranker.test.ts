import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { container } from "tsyringe";
import { createLocalRerankerProvider } from "./local.reranker";

describe("local reranker provider", () => {
  it("uses ModelService.getLocalRerankerRuntime()", async () => {
    container.clearInstances();
    container.registerInstance("ModelService", {
      async getLocalRerankerRuntime() {
        return {
          async tokenizePairs() {
            return {};
          },
          async score() {
            return [0.2, 0.9];
          },
        };
      },
    });

    const provider = createLocalRerankerProvider(container);
    const rows = [
      { chunkId: "a", score: 0, scores: {}, text: "a" },
      { chunkId: "b", score: 0, scores: {}, text: "b" },
    ] as any;

    const ranked = await provider.rerank("query", rows, { topK: 1 });

    expect(ranked.map((row) => row.chunkId)).toEqual(["b"]);
    expect(provider.type).toBe("local");
  });
});
