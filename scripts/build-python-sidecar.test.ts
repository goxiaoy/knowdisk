import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPythonSidecar } from "./build-python-sidecar";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("buildPythonSidecar", () => {
  test("includes hidden imports for dynamically loaded transformers modules", async () => {
    const root = makeTempDir();
    const workerSourceDir = join(root, "python");
    const outputDir = join(root, "vendor", "python-sidecar");
    const invocations: Array<{
      command: string;
      args: string[];
      options?: { cwd?: string };
    }> = [];

    await buildPythonSidecar({
      workerSourceDir,
      outputDir,
      platform: "darwin",
      run: async (command, args, options) => {
        invocations.push({ command, args, options });
        const sidecarDir = join(outputDir, "mac", "knowdisk-python-worker");
        mkdirSync(sidecarDir, { recursive: true });
        writeFileSync(join(sidecarDir, "knowdisk-python-worker"), "#!/bin/sh\nexit 0\n");
      },
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.command).toBe("uv");
    expect(invocations[0]?.args).toEqual(
      expect.arrayContaining([
        "--hidden-import",
        "transformers.models.metaclip_2",
      ])
    );
  });
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-sidecar-build-"));
  tempDirs.push(dir);
  return dir;
}
