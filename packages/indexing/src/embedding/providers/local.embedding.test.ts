import "reflect-metadata";
import { describe, expect, it, mock } from "bun:test";
import { container } from "tsyringe";
import { createLocalEmbeddingProvider } from "./local.embedding";

describe("local embedding provider", () => {
  it("throws a clear error when ModelService is missing", async () => {
    container.clearInstances();

    expect(() => createLocalEmbeddingProvider(container)).toThrow(
      'Local embedding provider requires "ModelService"',
    );
  });

  it("uses ModelService.getLocalEmbeddingExtractor()", async () => {
    const extractor = mock(async () => ({ data: [0.1, 0.2, 0.3] }));
    container.clearInstances();
    container.registerInstance("ModelService", {
      async getLocalEmbeddingExtractor() {
        return extractor;
      },
    });

    const provider = createLocalEmbeddingProvider(container, {
      dimension: 3,
    });

    await expect(provider.embed("hello")).resolves.toEqual([0.1, 0.2, 0.3]);
    expect(extractor).toHaveBeenCalledTimes(1);
    expect(provider.type).toBe("local");
  });
});
