import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  resolvePythonWorkerCommand,
  resolveRepoPythonProjectDirFromModule,
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
      })
    ).toEqual([
      "/Applications/Know Disk.app/Contents/Resources/python-runtime/bin/python",
      "/Applications/Know Disk.app/Contents/Resources/python-worker/worker/__main__.py",
    ]);
  });

  test("derives repo python project from module path", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "knowdisk-python-command-repo-"));
    mkdirSync(join(repoRoot, "python"), { recursive: true });
    writeFileSync(join(repoRoot, "python", "pyproject.toml"), "[project]\nname='test'\n");
    mkdirSync(join(repoRoot, "src", "bun", "python"), { recursive: true });

    expect(
      resolveRepoPythonProjectDirFromModule(
        pathToFileURL(join(repoRoot, "src", "bun", "python", "command.ts")).href,
        { cwd: repoRoot }
      )
    ).toBe(join(repoRoot, "python"));
  });

  test("falls back to cwd when module path is inside the generated dev app bundle", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "knowdisk-python-command-build-"));
    mkdirSync(join(repoRoot, "python"), { recursive: true });
    writeFileSync(join(repoRoot, "python", "pyproject.toml"), "[project]\nname='test'\n");
    mkdirSync(
      join(repoRoot, "build", "dev-macos-arm64", "Know Disk-dev.app", "Contents", "Resources", "app", "bun"),
      { recursive: true }
    );

    expect(
      resolveRepoPythonProjectDirFromModule(
        pathToFileURL(
          join(
            repoRoot,
            "build",
            "dev-macos-arm64",
            "Know Disk-dev.app",
            "Contents",
            "Resources",
            "app",
            "bun",
            "index.js"
          )
        ).href,
        { cwd: repoRoot }
      )
    ).toBe(join(repoRoot, "python"));
  });

  test("uses repo-local python project in development runtime mode", () => {
    expect(
      resolvePythonWorkerCommandForRuntime({
        platform: "darwin",
        channel: "dev",
        execPath: "/usr/local/bin/bun",
      })
    ).toEqual([
      "uv",
      "run",
      "--project",
      "/Users/goxy/projects/knowdisk/python",
      "python",
      "-m",
      "worker",
    ]);
  });

  test("uses bundled python runtime outside the dev channel on macos", () => {
    expect(
      resolvePythonWorkerCommandForRuntime({
        platform: "darwin",
        channel: "prod",
        execPath: "/Applications/Know Disk.app/Contents/MacOS/Know Disk",
      })
    ).toEqual([
      "/Applications/Know Disk.app/Contents/Resources/python-runtime/bin/python",
      "/Applications/Know Disk.app/Contents/Resources/python-worker/worker/__main__.py",
    ]);
  });
});
