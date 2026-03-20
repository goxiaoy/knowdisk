import { dirname, join, resolve } from "node:path";

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

export function resolvePythonWorkerCommandForRuntime(input: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  execPath: string;
  cwd: string;
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
    repoPythonProjectDir: join(input.cwd, "python"),
    resourcesDir: "",
  });
}
