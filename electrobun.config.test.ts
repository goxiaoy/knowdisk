import { describe, expect, test } from "bun:test";
import config from "./electrobun.config";

describe("electrobun config", () => {
  test("copies bundled python runtime resources into the packaged app", () => {
    expect(config.build.copy["vendor/python-runtime"]).toBe("python-runtime");
    expect(config.build.copy["vendor/python-worker"]).toBe("python-worker");
  });
});
