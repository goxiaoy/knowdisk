import type { FsEvent } from "./fs.types";

export function normalizeEvent(kind: string, path: string, nextPath?: string): FsEvent {
  if (kind === "rename" && nextPath) {
    return { type: "renamed", path, nextPath };
  }
  if (kind === "rename") {
    return { type: "updated", path };
  }
  if (kind === "change") {
    return { type: "updated", path };
  }
  return { type: "updated", path };
}
