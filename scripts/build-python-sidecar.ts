import { mkdir, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

export type SidecarPlatform = "mac" | "linux" | "win";

export function normalizeSidecarPlatform(platform: NodeJS.Platform | string): SidecarPlatform {
  if (platform === "darwin") {
    return "mac";
  }
  if (platform === "win32") {
    return "win";
  }
  return "linux";
}

export function sidecarExecutableName(platform: NodeJS.Platform | string): string {
  return normalizeSidecarPlatform(platform) === "win"
    ? "knowdisk-python-worker.exe"
    : "knowdisk-python-worker";
}

export async function buildPythonSidecar(input: {
  workerSourceDir: string;
  outputDir: string;
  platform?: NodeJS.Platform | string;
  run?: (command: string, args: string[], options?: { cwd?: string }) => Promise<void>;
}): Promise<{
  platformDir: string;
  executableName: string;
}> {
  const platform = input.platform ?? process.platform;
  const sidecarPlatform = normalizeSidecarPlatform(platform);
  const executableName = sidecarExecutableName(platform);
  const platformDir = join(input.outputDir, sidecarPlatform);
  const workDir = join(input.outputDir, `.pyinstaller-${sidecarPlatform}`);
  const sidecarBundleDir = join(platformDir, "knowdisk-python-worker");
  const runner = input.run ?? runCommand;

  await rm(platformDir, { recursive: true, force: true });
  await rm(workDir, { recursive: true, force: true });
  await mkdir(input.outputDir, { recursive: true });

  await runner(
    "uv",
    [
      "run",
      "--project",
      input.workerSourceDir,
      "--with",
      "pyinstaller",
      "pyinstaller",
      "--noconfirm",
      "--clean",
      "--onedir",
      "--name",
      "knowdisk-python-worker",
      "--distpath",
      platformDir,
      "--workpath",
      workDir,
      "--specpath",
      workDir,
      "--paths",
      input.workerSourceDir,
      join(input.workerSourceDir, "worker", "__main__.py"),
    ],
    { cwd: process.cwd() }
  );

  await assertExists(
    join(sidecarBundleDir, executableName),
    "bundled python sidecar executable not found"
  );

  return {
    platformDir,
    executableName,
  };
}

async function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string }
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
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
          `python sidecar build failed (code=${code ?? "null"}, signal=${signal ?? "null"})`
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
