import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  test("stages worker files and bundled runtime under vendor", async () => {
    const root = makeTempDir();
    const workerSourceDir = join(root, "python");
    const runtimeSourceDir = join(root, "runtime-src");
    const vendorDir = join(root, "vendor");

    mkdirSync(join(workerSourceDir, "worker"), { recursive: true });
    mkdirSync(join(runtimeSourceDir, "bin"), { recursive: true });
    writeFileSync(join(workerSourceDir, "worker", "__main__.py"), "print('worker')\n");
    writeFileSync(join(workerSourceDir, "worker", "server.py"), "SERVER = True\n");
    writeFileSync(join(runtimeSourceDir, "bin", "python"), "#!/usr/bin/env python3\n");

    const result = await preparePythonRuntime({
      workerSourceDir,
      runtimeSourceDir,
      vendorDir,
    });

    expect(result).toEqual({
      workerDir: join(vendorDir, "python-worker"),
      runtimeDir: join(vendorDir, "python-runtime"),
    });
    expect(existsSync(join(vendorDir, "python-worker", "worker", "__main__.py"))).toBe(true);
    expect(existsSync(join(vendorDir, "python-runtime", "bin", "python"))).toBe(true);
  });

  test("fails when staged runtime is missing interpreter", async () => {
    const root = makeTempDir();
    const workerSourceDir = join(root, "python");
    const runtimeSourceDir = join(root, "runtime-src");
    const vendorDir = join(root, "vendor");

    mkdirSync(join(workerSourceDir, "worker"), { recursive: true });
    mkdirSync(runtimeSourceDir, { recursive: true });
    writeFileSync(join(workerSourceDir, "worker", "__main__.py"), "print('worker')\n");

    await expect(
      preparePythonRuntime({
        workerSourceDir,
        runtimeSourceDir,
        vendorDir,
      })
    ).rejects.toThrow("bundled python interpreter not found");
  });

  test("fails when staged worker is missing entrypoint", async () => {
    const root = makeTempDir();
    const workerSourceDir = join(root, "python");
    const runtimeSourceDir = join(root, "runtime-src");
    const vendorDir = join(root, "vendor");

    mkdirSync(join(workerSourceDir, "worker"), { recursive: true });
    mkdirSync(join(runtimeSourceDir, "bin"), { recursive: true });
    writeFileSync(join(runtimeSourceDir, "bin", "python"), "#!/usr/bin/env python3\n");

    await expect(
      preparePythonRuntime({
        workerSourceDir,
        runtimeSourceDir,
        vendorDir,
      })
    ).rejects.toThrow("python worker entrypoint not found");
  });
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-python-runtime-"));
  tempDirs.push(dir);
  return dir;
}
