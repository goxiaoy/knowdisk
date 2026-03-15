import { describe, expect, it } from "bun:test";
import { createLoggerService } from "./index";

describe("createLoggerService", () => {
  it("applies default name and default level", () => {
    const logger = createLoggerService();
    const bindings = logger.bindings();

    expect(bindings.name).toBe("knowdisk");
    expect(logger.level).toBe("info");
  });

  it("supports overriding name and level", () => {
    const logger = createLoggerService({ name: "core-test", level: "debug" });
    const bindings = logger.bindings();

    expect(bindings.name).toBe("core-test");
    expect(logger.level).toBe("debug");
  });
});
