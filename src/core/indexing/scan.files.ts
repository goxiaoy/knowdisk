import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export async function collectIndexableFiles(sourcePath: string): Promise<string[]> {
  const sourceStat = await stat(sourcePath);
  if (sourceStat.isFile()) {
    return [sourcePath];
  }

  if (!sourceStat.isDirectory()) {
    return [];
  }

  const results: string[] = [];
  const queue = [sourcePath];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }
  return results;
}
