import type { VfsProviderAdapter } from "./vfs.provider.types";
import type { GetMetadataOperation, ListChildrenItem } from "./vfs.service.types";
import type { VfsMountConfig } from "./vfs.types";

export type WalkProviderEntry = ListChildrenItem & {
  path: string;
};

export type WalkProviderInput = {
  provider: Pick<VfsProviderAdapter, "listChildren">;
  mount: VfsMountConfig;
  parentSourceRef?: string | null;
  limit?: number;
  getMetadata?: GetMetadataOperation;
};

export type WalkProviderCallback = (
  error: Error | null,
  entries: WalkProviderEntry[],
) => void;

export function walk(
  input: WalkProviderInput,
  callback?: WalkProviderCallback,
): Promise<WalkProviderEntry[]> {
  const run = async (): Promise<WalkProviderEntry[]> => {
    const out: WalkProviderEntry[] = [];
    const queue: Array<string | null> = [input.parentSourceRef ?? null];
    const limit = input.limit ?? 200;
    while (queue.length > 0) {
      const parentSourceRef = queue.shift() ?? null;
      let cursor: string | undefined;
      do {
        const page = await input.provider.listChildren({
          mount: input.mount,
          parentSourceRef,
          limit,
          cursor,
        });
        for (const item of page.items) {
          const normalized = await enrichMetadataIfNeeded(item, input.getMetadata, input.mount);
          out.push({
            ...normalized,
            path: normalized.sourceRef,
          });
          if (normalized.kind === "folder") {
            queue.push(normalized.sourceRef);
          }
        }
        cursor = page.nextCursor;
      } while (cursor);
    }
    return out;
  };

  if (!callback) {
    return run();
  }

  return run()
    .then((entries) => {
      callback(null, entries);
      return entries;
    })
    .catch((error) => {
      callback(error as Error, []);
      throw error;
    });
}

export const walkProvider = walk;

async function enrichMetadataIfNeeded(
  item: ListChildrenItem,
  getMetadata: GetMetadataOperation | undefined,
  mount: VfsMountConfig,
): Promise<ListChildrenItem> {
  if (item.kind !== "file" || (item.size ?? 0) > 0 || !getMetadata) {
    return item;
  }
  const metadata = await getMetadata({ mount, sourceRef: item.sourceRef });
  if (!metadata) {
    return item;
  }
  return {
    ...item,
    size: metadata.size ?? item.size,
    mtimeMs: metadata.mtimeMs ?? item.mtimeMs,
    providerVersion: metadata.providerVersion ?? item.providerVersion,
    title: metadata.title ?? item.title,
  };
}
