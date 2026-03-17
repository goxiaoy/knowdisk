import { join } from "node:path";

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
