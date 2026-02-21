import { describe, expect, test } from "bun:test";
import { getDefaultConfig } from "./config.service";

describe("getDefaultConfig", () => {
  test("returns safe-preset defaults", () => {
    const cfg = getDefaultConfig();
    expect(cfg.ui.mode).toBe("safe");
    expect(cfg.indexing.watch.enabled).toBe(true);
  });
});
