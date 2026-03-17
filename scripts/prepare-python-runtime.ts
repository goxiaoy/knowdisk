import { cp, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

export async function preparePythonRuntime(input: {
  workerSourceDir: string;
  runtimeSourceDir: string;
  vendorDir: string;
}): Promise<{
  workerDir: string;
  runtimeDir: string;
}> {
  const workerDir = join(input.vendorDir, "python-worker");
  const runtimeDir = join(input.vendorDir, "python-runtime");

  await rm(workerDir, { recursive: true, force: true });
  await rm(runtimeDir, { recursive: true, force: true });
  await mkdir(input.vendorDir, { recursive: true });

  await cp(join(input.workerSourceDir, "worker"), join(workerDir, "worker"), { recursive: true });
  await cp(input.runtimeSourceDir, runtimeDir, { recursive: true });

  await assertExists(join(workerDir, "worker", "__main__.py"), "python worker entrypoint not found");
  await assertExists(
    join(runtimeDir, "bin", "python"),
    "bundled python interpreter not found"
  );

  return { workerDir, runtimeDir };
}

async function assertExists(path: string, message: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    throw new Error(message);
  }
}

if (import.meta.main) {
  const runtimeSourceDir = process.env.KNOWDISK_PYTHON_RUNTIME_DIR?.trim();
  if (!runtimeSourceDir) {
    throw new Error("KNOWDISK_PYTHON_RUNTIME_DIR is required");
  }

  await preparePythonRuntime({
    workerSourceDir: join(process.cwd(), "python"),
    runtimeSourceDir,
    vendorDir: join(process.cwd(), "vendor"),
  });
}
