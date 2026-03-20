import type { VfsNode } from "@knowdisk/vfs";
import type { SearchResult } from "../shared/files";

const DEFAULT_RECENT_FILES_LIMIT = 20;

export function buildRecentFileSearchResults(input: {
  nodesByMount: Iterable<readonly VfsNode[]>;
  limit?: number;
}): SearchResult[] {
  const results = [...input.nodesByMount]
    .flatMap((nodes) => nodes)
    .filter((node) => node.kind === "file" && node.deletedAtMs === null)
    .sort((left, right) => getNodeRecencyMs(right) - getNodeRecencyMs(left))
    .slice(0, input.limit ?? DEFAULT_RECENT_FILES_LIMIT)
    .map((node) => ({
      nodeId: node.nodeId,
      mountId: node.mountId,
      sourceRef: node.sourceRef,
      name: node.name,
      title: node.name,
      text: node.sourceRef,
    }));

  return results;
}

function getNodeRecencyMs(node: VfsNode): number {
  return node.mtimeMs ?? node.updatedAtMs;
}
