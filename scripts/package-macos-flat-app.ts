import { copyFile, mkdtemp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawn } from "node:child_process";

type Run = (command: string, args: string[]) => Promise<void>;

export async function packageMacosFlatApp(input: {
  sourceTarballPath: string;
  outputDir: string;
  appName: string;
  artifactStem: string;
  volumeName: string;
  extractTarball?: (input: { sourceTarballPath: string; destinationDir: string }) => Promise<void>;
  run?: Run;
}): Promise<{
  appPath: string;
  zipPath: string;
  dmgPath: string;
}> {
  await assertExists(input.sourceTarballPath, "flat macos source tarball not found");

  const run = input.run ?? runCommand;
  const extractTarball = input.extractTarball ?? extractTarballFromZstd;
  const stagingRoot = await mkdtemp(join(tmpdir(), "knowdisk-flat-app-stage-"));
  const extractDir = join(stagingRoot, "staging");
  const stagedTarballPath = join(stagingRoot, basename(input.sourceTarballPath));
  const zipPath = join(input.outputDir, `${input.artifactStem}.app.zip`);
  const dmgPath = join(input.outputDir, `${input.artifactStem}.dmg`);

  await copyFile(input.sourceTarballPath, stagedTarballPath);
  await rm(input.outputDir, { recursive: true, force: true });
  await mkdir(input.outputDir, { recursive: true });
  await mkdir(extractDir, { recursive: true });

  await extractTarball({
    sourceTarballPath: stagedTarballPath,
    destinationDir: extractDir,
  });

  const appPath = join(extractDir, input.appName);
  await assertExists(appPath, "flat macos app bundle not found after extraction");

  await run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, zipPath]);
  await run("hdiutil", ["create", "-volname", input.volumeName, "-srcfolder", appPath, "-ov", "-format", "UDZO", dmgPath]);

  return {
    appPath,
    zipPath,
    dmgPath,
  };
}

async function extractTarballFromZstd(input: {
  sourceTarballPath: string;
  destinationDir: string;
}): Promise<void> {
  const stagingRoot = await mkdtemp(join(tmpdir(), "knowdisk-flat-zstd-"));
  const tarPath = join(stagingRoot, `${basename(input.sourceTarballPath, ".zst")}`);

  await runCommand("uv", [
    "run",
    "--with",
    "zstandard",
    "python",
    "-c",
    [
      "from pathlib import Path",
      "import zstandard as zstd",
      `src = Path(${JSON.stringify(input.sourceTarballPath)})`,
      `out = Path(${JSON.stringify(tarPath)})`,
      "out.parent.mkdir(parents=True, exist_ok=True)",
      "infh = src.open('rb')",
      "outfh = out.open('wb')",
      "zstd.ZstdDecompressor().copy_stream(infh, outfh)",
      "outfh.close()",
      "infh.close()",
    ].join("; "),
  ]);

  await runCommand("tar", ["-xf", tarPath, "-C", input.destinationDir]);
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `command failed: ${command} ${args.join(" ")} (code=${code ?? "null"}, signal=${signal ?? "null"})`
        )
      );
    });
  });
}

async function assertExists(path: string, message: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    throw new Error(message);
  }
}

if (import.meta.main) {
  await packageMacosFlatApp({
    sourceTarballPath: await resolveStableMacosTarballPath(process.cwd()),
    outputDir: join(process.cwd(), "artifacts"),
    appName: "Know Disk.app",
    artifactStem: "stable-macos-arm64-KnowDisk",
    volumeName: "Know Disk",
  });
}

async function resolveStableMacosTarballPath(cwd: string): Promise<string> {
  const resourcesDir = join(
    cwd,
    "build",
    "stable-macos-arm64",
    "Know Disk.app",
    "Contents",
    "Resources"
  );
  const entries = await readdir(resourcesDir);
  const tarballName = entries.find((entry) => entry.endsWith(".tar.zst"));
  if (!tarballName) {
    throw new Error("stable macos source tarball not found in build output");
  }
  return join(resourcesDir, tarballName);
}
