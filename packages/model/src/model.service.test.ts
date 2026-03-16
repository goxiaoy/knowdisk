import { describe, expect, it, mock } from "bun:test";
import { createDefaultCoreConfig, createLoggerService } from "@knowdisk/core";
import { createModelService } from "./index";

describe("createModelService", () => {
  it("exposes an idle status store before any work starts", () => {
    const service = createModelService({
      logger: createLoggerService({ level: "silent" }),
      config: createDefaultCoreConfig(),
      cacheDir: "build/models",
    });

    expect(service.getStatus().getSnapshot()).toEqual({
      phase: "idle",
      lastStartedAt: "",
      lastFinishedAt: "",
      progressPct: 0,
      error: "",
      tasks: {
        embedding: null,
        reranker: null,
      },
      retry: {
        attempt: 0,
        maxAttempts: 3,
        backoffMs: [3000, 10000, 30000],
        nextRetryAt: "",
        exhausted: false,
      },
    });
  });

  it("logs start and completion during ensureRequiredModels", async () => {
    const info = mock(() => {});
    const warn = mock(() => {});
    const error = mock(() => {});
    const logger = {
      info,
      warn,
      error,
    } as unknown as ReturnType<typeof createLoggerService>;

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
      logger,
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

    expect(info).toHaveBeenCalledWith({ scope: "all" }, "model ensure started");
    expect(info).toHaveBeenCalledWith({ scope: "all" }, "model ensure completed");
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
