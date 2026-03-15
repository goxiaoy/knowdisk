import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { createDefaultCoreConfig, createLoggerService } from "@knowdisk/core";
import { container } from "tsyringe";
import { createIndexingServiceFromConfig } from "./create-indexing-service-from-config";

describe("createIndexingServiceFromConfig", () => {
  it("selects local embedding and local reranker from CoreConfig", async () => {
    const config = createDefaultCoreConfig();
    container.clearInstances();
    container.registerInstance("CoreConfig", config);
    container.registerInstance("ModelService", {
      async getLocalEmbeddingExtractor() {
        return async () => ({ data: [0.1, 0.2] });
      },
      async getLocalRerankerRuntime() {
        return {
          async tokenizePairs() {
            return {};
          },
          async score() {
            return [0.5];
          },
        };
      },
    });

    const service = createIndexingServiceFromConfig(container, {
      logger: createLoggerService({ level: "silent" }),
      ftsRepository: {
        async replaceNodeChunks() {},
        async deleteByNodeId() {},
        async search() {
          return [];
        },
      },
      vectorRepository: {
        async replaceNodeChunks() {},
        async deleteByNodeId() {},
        async search() {
          return [];
        },
      },
    });

    const result = await service.search("hello");
    expect(result.meta.embeddingProvider).toBe("local");
    expect(result.meta.rerankerProvider).toBe("local");
  });
});
