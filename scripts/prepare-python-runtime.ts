import { cp, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  buildPythonSidecar,
  normalizeSidecarPlatform,
  type SidecarPlatform,
} from "./build-python-sidecar";

export async function preparePythonRuntime(input: {
  workerSourceDir: string;
  vendorDir: string;
  platform?: NodeJS.Platform | string;
  buildSidecar?: (input: {
    workerSourceDir: string;
    outputDir: string;
    platform?: NodeJS.Platform | string;
  }) => Promise<{
    platformDir: string;
    executableName: string;
  }>;
}): Promise<{
  sidecarDir: string;
  executablePath: string;
}> {
  const platform = input.platform ?? process.platform;
  const sidecarPlatform = normalizeSidecarPlatform(platform);
  const stageRootDir = join(input.vendorDir, ".python-sidecar-build");
  const sidecarRootDir = join(input.vendorDir, "python-sidecar");
  const sidecarDir = join(sidecarRootDir, sidecarPlatform);
  const buildSidecar = input.buildSidecar ?? buildPythonSidecar;

  await rm(join(input.vendorDir, "python-worker"), { recursive: true, force: true });
  await rm(join(input.vendorDir, "python-runtime"), { recursive: true, force: true });
  await rm(sidecarRootDir, { recursive: true, force: true });
  await rm(stageRootDir, { recursive: true, force: true });
  await mkdir(input.vendorDir, { recursive: true });

  const builtSidecar = await buildSidecar({
    workerSourceDir: input.workerSourceDir,
    outputDir: stageRootDir,
    platform,
  });

  await cp(builtSidecar.platformDir, sidecarDir, { recursive: true });
  await rm(stageRootDir, { recursive: true, force: true });

  const executablePath = join(
    sidecarDir,
    "knowdisk-python-worker",
    executableNameForPlatform(sidecarPlatform, builtSidecar.executableName)
  );
  await assertExists(executablePath, "bundled python sidecar executable not found");

  return { sidecarDir, executablePath };
}

function executableNameForPlatform(
  sidecarPlatform: SidecarPlatform,
  executableName: string
): string {
  if (sidecarPlatform === "win" && !executableName.endsWith(".exe")) {
    return `${executableName}.exe`;
  }
  return executableName;
}

async function assertExists(path: string, message: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    throw new Error(message);
  }
}

if (import.meta.main) {
  await preparePythonRuntime({
    workerSourceDir: join(process.cwd(), "python"),
    vendorDir: join(process.cwd(), "vendor"),
  });
}
