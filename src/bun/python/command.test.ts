import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  resolvePythonWorkerCommand,
  resolvePythonWorkerCommandForRuntime,
} from "./command";

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

  test("derives packaged macos resources from the app executable path", () => {
    expect(
      resolvePythonWorkerCommandForRuntime({
        platform: "darwin",
        isPackaged: true,
        execPath: "/Applications/Know Disk.app/Contents/MacOS/Know Disk",
        cwd: "/repo",
      })
    ).toEqual([
      "/Applications/Know Disk.app/Contents/Resources/python-runtime/bin/python",
      "/Applications/Know Disk.app/Contents/Resources/python-worker/worker/__main__.py",
    ]);
  });

  test("uses repo-local python project in development runtime mode", () => {
    expect(
      resolvePythonWorkerCommandForRuntime({
        platform: "darwin",
        isPackaged: false,
        execPath: "/usr/local/bin/bun",
        cwd: "/repo",
      })
    ).toEqual(["uv", "run", "--project", "/repo/python", "python", "-m", "worker"]);
  });
});
