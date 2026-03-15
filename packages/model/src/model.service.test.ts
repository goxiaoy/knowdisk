import { describe, expect, it } from "bun:test";
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
});
