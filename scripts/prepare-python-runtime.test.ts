import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preparePythonRuntime } from "./prepare-python-runtime";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("preparePythonRuntime", () => {
  test("stages packaged python sidecar assets under vendor", async () => {
    const root = makeTempDir();
    const workerSourceDir = join(root, "python");
    const vendorDir = join(root, "vendor");
    const builtSidecarDir = join(root, "built-sidecar");

    mkdirSync(workerSourceDir, { recursive: true });
    mkdirSync(join(builtSidecarDir, "knowdisk-python-worker"), { recursive: true });
    writeFileSync(
      join(builtSidecarDir, "knowdisk-python-worker", "knowdisk-python-worker"),
      "#!/bin/sh\nexit 0\n"
    );
    writeFileSync(
      join(builtSidecarDir, "knowdisk-python-worker", "manifest.json"),
      '{"kind":"sidecar"}\n'
    );

    const result = await preparePythonRuntime({
      workerSourceDir,
      vendorDir,
      platform: "darwin",
      buildSidecar: async () => ({
        platformDir: builtSidecarDir,
        executableName: "knowdisk-python-worker",
      }),
    });

    expect(result).toEqual({
      sidecarDir: join(vendorDir, "python-sidecar", "mac"),
      executablePath: join(
        vendorDir,
        "python-sidecar",
        "mac",
        "knowdisk-python-worker",
        "knowdisk-python-worker"
      ),
    });
    expect(existsSync(result.executablePath)).toBe(true);
    expect(readFileSync(join(result.sidecarDir, "knowdisk-python-worker", "manifest.json"), "utf8")).toContain(
      "sidecar"
    );
    expect(existsSync(join(vendorDir, "python-runtime"))).toBe(false);
  });

  test("fails when staged sidecar executable is missing", async () => {
    const root = makeTempDir();
    const workerSourceDir = join(root, "python");
    const vendorDir = join(root, "vendor");
    const builtSidecarDir = join(root, "built-sidecar");

    mkdirSync(workerSourceDir, { recursive: true });
    mkdirSync(join(builtSidecarDir, "knowdisk-python-worker"), { recursive: true });

    await expect(
      preparePythonRuntime({
        workerSourceDir,
        vendorDir,
        platform: "darwin",
        buildSidecar: async () => ({
          platformDir: builtSidecarDir,
          executableName: "knowdisk-python-worker",
        }),
      })
    ).rejects.toThrow("bundled python sidecar executable not found");
  });
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-python-runtime-"));
  tempDirs.push(dir);
  return dir;
}
