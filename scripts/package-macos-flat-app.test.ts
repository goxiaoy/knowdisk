import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageMacosFlatApp } from "./package-macos-flat-app";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("packageMacosFlatApp", () => {
  test("fails when the source tarball is missing", async () => {
    const root = makeTempDir();

    await expect(
      packageMacosFlatApp({
        sourceTarballPath: join(root, "missing.app.tar.zst"),
        outputDir: join(root, "artifacts"),
        appName: "Know Disk.app",
        artifactStem: "stable-macos-arm64-KnowDisk",
        volumeName: "Know Disk",
      })
    ).rejects.toThrow("flat macos source tarball not found");
  });

  test("creates zip and dmg artifacts from a flat app tarball", async () => {
    const root = makeTempDir();
    const sourceTarballPath = join(root, "KnowDisk.app.tar.zst");
    const outputDir = join(root, "artifacts");
    const zipPath = join(outputDir, "stable-macos-arm64-KnowDisk.app.zip");
    const dmgPath = join(outputDir, "stable-macos-arm64-KnowDisk.dmg");
    const commands: string[] = [];
    let extractedAppDir = "";

    writeFileSync(sourceTarballPath, "tarball");

    const result = await packageMacosFlatApp({
      sourceTarballPath,
      outputDir,
      appName: "Know Disk.app",
      artifactStem: "stable-macos-arm64-KnowDisk",
      volumeName: "Know Disk",
      extractTarball: async ({ destinationDir }) => {
        extractedAppDir = join(destinationDir, "Know Disk.app");
        mkdirSync(extractedAppDir, { recursive: true });
        writeFileSync(join(extractedAppDir, "Info.plist"), "plist");
        commands.push(`extract:${destinationDir}`);
      },
      run: async (command, args) => {
        commands.push([command, ...args].join(" "));
        const target = args.at(-1);
        if (target) {
          mkdirSync(join(target, ".."), { recursive: true });
          writeFileSync(target, command);
        }
      },
    });

    expect(result).toEqual({
      appPath: extractedAppDir,
      zipPath,
      dmgPath,
    });
    expect(commands[0]).toContain("extract:");
    expect(commands.some((entry) => entry.startsWith("ditto "))).toBe(true);
    expect(commands.some((entry) => entry.startsWith("hdiutil "))).toBe(true);
    expect(existsSync(zipPath)).toBe(true);
    expect(existsSync(dmgPath)).toBe(true);
    expect(readFileSync(zipPath, "utf8")).toBe("ditto");
    expect(readFileSync(dmgPath, "utf8")).toBe("hdiutil");
  });
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-flat-app-"));
  tempDirs.push(dir);
  return dir;
}
