import { describe, expect, it } from "bun:test";
import { createDefaultCoreConfig, createLoggerService } from "@knowdisk/core";
import { createModelService } from "./index";

describe("local model task selection", () => {
  it("selects both tasks when embedding and reranker are local", async () => {
    const service = createModelService({
      logger: createLoggerService({ level: "silent" }),
      config: createDefaultCoreConfig(),
      cacheDir: "build/models",
    });

    await service.ensureRequiredModels();

    const status = service.getStatus().getSnapshot();
    expect(status.tasks.embedding?.provider).toBe("local");
    expect(status.tasks.reranker?.provider).toBe("local");
  });
});
