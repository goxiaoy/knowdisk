import { describe, expect, test } from "bun:test";
import packageJson from "./package.json";

describe("package scripts", () => {
  test("dev startup does not require packaged python runtime preparation", () => {
    expect(packageJson.scripts.dev).not.toContain("prepare:python-runtime");
    expect(packageJson.scripts.dev).toContain("vite --port 5173");
    expect(packageJson.scripts.dev).toContain("electrobun dev");
  });

  test("build keeps bundled python runtime preparation for packaged apps", () => {
    expect(packageJson.scripts["build:dev"]).toBe("bun run prepare:native && vite build && electrobun build");
    expect(packageJson.scripts.build).toContain("prepare:python-runtime");
    expect(packageJson.scripts["build:prod"]).toContain("prepare:python-runtime");
  });

  test("hmr alias matches the default dev startup", () => {
    expect(packageJson.scripts["dev:hmr"]).toBe(packageJson.scripts.dev);
  });
});
