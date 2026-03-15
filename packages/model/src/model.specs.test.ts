import { describe, expect, it } from "bun:test";
import { createDefaultCoreConfig, createLoggerService } from "@knowdisk/core";
import { createModelService } from "./index";

describe("local model task selection", () => {
  it("selects both tasks when embedding and reranker are local", async () => {
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/models/")) {
        return new Response(
          JSON.stringify({
            siblings: [{ rfilename: "onnx/model.onnx", size: 4 }],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          }
        );
      }
      return new Response("test", {
        status: 200,
        headers: {
          "content-length": "4",
          "content-type": "application/octet-stream",
        },
      });
    };

    const service = createModelService({
      logger: createLoggerService({ level: "silent" }),
      config: createDefaultCoreConfig(),
      cacheDir: "build/models",
      deps: {
        fetch: fetchImpl,
        loadEmbeddingExtractor: async () => async () => ({ data: [1] }),
        loadRerankerRuntime: async () => ({
          async tokenizePairs() {
            return {};
          },
          async score() {
            return [1];
          },
        }),
      },
    });

    await service.ensureRequiredModels();

    const status = service.getStatus().getSnapshot();
    expect(status.tasks.embedding?.provider).toBe("local");
    expect(status.tasks.reranker?.provider).toBe("local");
  });
});
