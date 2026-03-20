import { describe, expect, test } from "bun:test";
import { createBuildCopyConfig, defaultBuildCopyConfig } from "./electrobun.config";

describe("electrobun config", () => {
  test("includes bundled python runtime resources when staged assets exist", () => {
    const copy = createBuildCopyConfig({
      existsSync: (path) =>
        path === "vendor/python-runtime" || path === "vendor/python-worker",
    });

    expect(copy["vendor/python-runtime"]).toBe("python-runtime");
    expect(copy["vendor/python-worker"]).toBe("python-worker");
  });

  test("skips bundled python runtime resources when staged assets are absent", () => {
    const copy = createBuildCopyConfig({
      existsSync: () => false,
    });

    expect(copy["vendor/python-runtime"]).toBeUndefined();
    expect(copy["vendor/python-worker"]).toBeUndefined();
    expect(copy["dist/index.html"]).toBe("views/app/index.html");
    expect(copy["vendor/node_modules/sharp"]).toBe("node_modules/sharp");
  });

  test("exports the default build copy config", () => {
    expect(defaultBuildCopyConfig["dist/assets"]).toBe("views/app/assets");
  });
});
