import { describe, expect, it } from "bun:test";
import { createDefaultCoreConfig, createLoggerService } from "@knowdisk/core";
import { createModelService } from "./index";

describe("model status store", () => {
  it("notifies listeners when status changes", async () => {
    const service = createModelService({
      logger: createLoggerService({ level: "silent" }),
      config: createDefaultCoreConfig(),
      cacheDir: "build/models",
    });

    const events: string[] = [];
    const unsubscribe = service.getStatus().subscribe((status) => {
      events.push(status.phase);
    });

    await service.retryNow();
    unsubscribe();

    expect(events.length).toBeGreaterThan(0);
  });
});
