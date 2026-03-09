import type { VfsProviderAdapter } from "./vfs.provider.types";
import { complete, type VfsNode, type VfsNodeRequiredField } from "./vfs.types";

export type WalkProviderEntry = VfsNode & {
  path: string;
};

const itemProviderId = (item: VfsNode): string => item.nodeId || item.sourceRef;

export type WalkProviderInput = {
  provider: VfsProviderAdapter;
  parentId?: string | null;
  limit?: number;
  requiredFields?: VfsNodeRequiredField[];
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
    const queue: Array<{
      parentId: string | null;
      parentSourceRef: string | null;
    }> = [
      {
        parentId: input.parentId ?? null,
        parentSourceRef: null,
      },
    ];
    const limit = input.limit ?? 200;
    const requiredFields = input.requiredFields ?? ["size"];
    while (queue.length > 0) {
      const { parentId, parentSourceRef } = queue.shift()!;
      let cursor: string | undefined;
      do {
        const page = await input.provider.listChildren({
          parentId,
          parentSourceRef,
          limit,
          cursor,
        } as unknown as Parameters<typeof input.provider.listChildren>[0]);
        for (const item of page.items) {
          const normalized = await enrichMetadataIfNeeded(
            item,
            input.provider,
            requiredFields,
          );
          out.push({
            ...normalized,
            path: normalized.sourceRef,
          });
          if (normalized.kind === "folder") {
            queue.push({
              parentId: itemProviderId(normalized),
              parentSourceRef: normalized.sourceRef,
            });
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
export async function enrichMetadataIfNeeded(
  item: VfsNode,
  provider: VfsProviderAdapter,
  requiredFields: VfsNodeRequiredField[],
): Promise<VfsNode> {
  if (item.kind !== "file" || complete(item, requiredFields)) {
    return item;
  }
  const requireProviderVersion = requiredFields.includes("providerVersion");
  const metadataFields = requiredFields.filter(
    (field) => field !== "providerVersion",
  );
  let metadata: VfsNode | null = null;
  const needMetadataFields =
    metadataFields.length > 0 && !complete(item, metadataFields);
  const needProviderVersionFromMetadata =
    requireProviderVersion &&
    !provider.getVersion &&
    !complete(item, ["providerVersion"]);
  if (needMetadataFields || needProviderVersionFromMetadata) {
    metadata = await provider.getMetadata({ id: itemProviderId(item) });
  }
  let providerVersion = item.providerVersion;
  if (requireProviderVersion && !complete(item, ["providerVersion"])) {
    providerVersion =
      (await provider.getVersion?.({ id: itemProviderId(item) })) ?? null;
    if (!providerVersion && metadata?.providerVersion) {
      providerVersion = metadata.providerVersion;
    }
  }
  if (!metadata && providerVersion === item.providerVersion) {
    return item;
  }
  return {
    ...item,
    size: metadata?.size ?? item.size,
    mtimeMs: metadata?.mtimeMs ?? item.mtimeMs,
    providerVersion,
  };
}
