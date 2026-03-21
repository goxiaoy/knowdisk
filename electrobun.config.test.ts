import { describe, expect, test } from "bun:test";
import config, { createBuildCopyConfig, defaultBuildCopyConfig } from "./electrobun.config";

describe("electrobun config", () => {
  test("includes bundled python sidecar resources when staged assets exist", () => {
    const copy = createBuildCopyConfig({
      existsSync: (path) =>
        path === "vendor/python-sidecar",
    });

    expect(copy["vendor/python-sidecar"]).toBe("python-sidecar");
    expect(copy["vendor/python-runtime"]).toBeUndefined();
    expect(copy["vendor/python-worker"]).toBeUndefined();
  });

  test("skips bundled python sidecar resources when staged assets are absent", () => {
    const copy = createBuildCopyConfig({
      existsSync: () => false,
    });

    expect(copy["vendor/python-sidecar"]).toBeUndefined();
    expect(copy["dist/index.html"]).toBe("views/app/index.html");
    expect(copy["vendor/node_modules/sharp"]).toBe("node_modules/sharp");
  });

  test("exports the default build copy config", () => {
    expect(defaultBuildCopyConfig["dist/assets"]).toBe("views/app/assets");
  });

  test("points all platform icon settings at the generated app icon assets", () => {
    expect(config.build.mac?.icons).toBe("assets/icon/icon.iconset");
    expect(config.build.linux?.icon).toBe("assets/icon/app-icon.png");
    expect(config.build.win?.icon).toBe("assets/icon/app-icon.png");
  });
});
