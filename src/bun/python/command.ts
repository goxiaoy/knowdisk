import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveRepoPythonProjectDirFromModule(
  moduleUrl: string,
  input?: { cwd?: string }
): string {
  const searchRoots = [dirname(fileURLToPath(moduleUrl)), input?.cwd ?? process.cwd()];

  for (const root of searchRoots) {
    const projectDir = findPythonProjectDir(root);
    if (projectDir) {
      return projectDir;
    }
  }

  return resolve(searchRoots[0], "..", "..", "..", "python");
}

export function resolvePythonWorkerCommand(input: {
  mode: "development" | "packaged-macos";
  repoPythonProjectDir: string;
  resourcesDir: string;
}): [string, ...string[]] {
  if (input.mode === "packaged-macos") {
    return [
      join(input.resourcesDir, "python-runtime", "bin", "python"),
      join(input.resourcesDir, "python-worker", "worker", "__main__.py"),
    ];
  }

  return ["uv", "run", "--project", input.repoPythonProjectDir, "python", "-m", "worker"];
}

function findPythonProjectDir(startDir: string): string | null {
  let current = resolve(startDir);

  while (true) {
    const candidate = join(current, "python");
    if (existsSync(join(candidate, "pyproject.toml"))) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function resolvePythonWorkerCommandForRuntime(input: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  execPath: string;
}): [string, ...string[]] {
  if (input.isPackaged && input.platform === "darwin") {
    return resolvePythonWorkerCommand({
      mode: "packaged-macos",
      repoPythonProjectDir: "",
      resourcesDir: resolve(dirname(input.execPath), "..", "Resources"),
    });
  }

  return resolvePythonWorkerCommand({
    mode: "development",
    repoPythonProjectDir: resolveRepoPythonProjectDirFromModule(import.meta.url),
    resourcesDir: "",
  });
}
