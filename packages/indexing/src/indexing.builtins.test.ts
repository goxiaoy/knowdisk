import { describe, expect, it } from "bun:test";
import * as indexing from "./index";

describe("indexing built-ins", () => {
  it("exports built-in registration and config-driven service helpers", () => {
    expect(indexing).toHaveProperty("registerBuiltInProviders");
    expect(indexing).toHaveProperty("createIndexingServiceFromConfig");
  });
});
