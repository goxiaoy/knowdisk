import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolvePythonWorkerCommand } from "./python-worker-command";

describe("resolvePythonWorkerCommand", () => {
  test("returns uv project command in development mode", () => {
    expect(
      resolvePythonWorkerCommand({
        mode: "development",
        repoPythonProjectDir: "/repo/python",
        resourcesDir: "/ignored",
      })
    ).toEqual(["uv", "run", "--project", "/repo/python", "python", "-m", "worker"]);
  });

  test("returns bundled interpreter and worker entrypoint in packaged macos mode", () => {
    expect(
      resolvePythonWorkerCommand({
        mode: "packaged-macos",
        repoPythonProjectDir: "/ignored",
        resourcesDir: "/App/Contents/Resources",
      })
    ).toEqual([
      join("/App/Contents/Resources", "python-runtime", "bin", "python"),
      join("/App/Contents/Resources", "python-worker", "worker", "__main__.py"),
    ]);
  });
});
