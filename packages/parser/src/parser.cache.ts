import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { ParseCachePaths, ParseManifest } from "./parser.types";

export async function readCachedMarkdown(
  paths: ParseCachePaths,
): Promise<{ markdown: string; manifest: ParseManifest } | null> {
  try {
    const [markdown, manifestText] = await Promise.all([
      readFile(paths.markdownPath, "utf8"),
      readFile(paths.manifestPath, "utf8"),
    ]);

    return {
      markdown,
      manifest: JSON.parse(manifestText) as ParseManifest,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

export async function writeCachedMarkdown(
  paths: ParseCachePaths,
  input: { markdown: string; manifest: ParseManifest },
): Promise<void> {
  await mkdir(paths.dir, { recursive: true });
  await Promise.all([
    writeFile(paths.markdownPath, input.markdown, "utf8"),
    writeFile(paths.manifestPath, JSON.stringify(input.manifest, null, 2), "utf8"),
  ]);
}

export async function writeParseError(
  paths: ParseCachePaths,
  input: { code: string; message: string; createdAt: string },
): Promise<void> {
  await mkdir(paths.dir, { recursive: true });
  await writeFile(paths.errorPath, JSON.stringify(input, null, 2), "utf8");
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
