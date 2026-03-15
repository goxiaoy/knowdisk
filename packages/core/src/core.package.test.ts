import { describe, expect, it } from "bun:test";
import * as core from "./index";

describe("@knowdisk/core package", () => {
  it("exports logger and config entry points", () => {
    expect(core).toHaveProperty("createLoggerService");
    expect(core).toHaveProperty("createDefaultCoreConfig");
    expect(core).toHaveProperty("validateCoreConfig");
  });
});
