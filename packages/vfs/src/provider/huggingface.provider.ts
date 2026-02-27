import type { VfsProviderAdapter } from "../vfs.provider.types";
import type { ListChildrenItem } from "../vfs.service.types";
import type { VfsMount } from "../vfs.types";

type HuggingFaceRepoResponse = {
  siblings?: Array<{ rfilename?: string; size?: number }>;
};

type CreateHuggingFaceVfsProviderDeps = {
  fetch?: typeof fetch;
};

const HUGGINGFACE_FILE_WHITELIST = new Set([
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "added_tokens.json",
  "vocab.txt",
  "vocab.json",
  "merges.txt",
  "tokenizer.model",
  "sentencepiece.bpe.model",
  "preprocessor_config.json",
]);
const DEFAULT_HUGGINGFACE_ENDPOINT = "https://huggingface.co";

export function createHuggingFaceVfsProvider(
  mount: VfsMount,
  deps?: CreateHuggingFaceVfsProviderDeps,
): VfsProviderAdapter {
  const fetchFn = deps?.fetch ?? fetch;
  return {
    type: "huggingface",
    capabilities: { watch: false },
    async listChildren(input) {
      const config = parseMountConfig(input.mount);
      const apiUrl = `${normalizeHost(config.endpoint)}/api/models/${encodePathSegment(config.model)}`;
      const response = await fetchFn(apiUrl);
      if (!response.ok) {
        throw new Error(
          `Failed to list model files: ${response.status} ${response.statusText}`,
        );
      }
      const payload = (await response.json()) as HuggingFaceRepoResponse;
      const allItems = buildListItems(payload.siblings ?? []);
      const parent = input.parentSourceRef ?? null;
      const directChildren = allItems
        .filter((item) => item.parentSourceRef === parent)
        .sort((a, b) => {
          if (a.kind !== b.kind) {
            return a.kind === "file" ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
      const offset = parseCursorOffset(input.cursor);
      const page = directChildren.slice(offset, offset + input.limit);
      const nextOffset = offset + input.limit;
      return {
        items: page,
        nextCursor: nextOffset < directChildren.length ? String(nextOffset) : undefined,
      };
    },
    async createReadStream(input) {
      const config = parseMountConfig(input.mount);
      if (!isWhitelistedFile(input.sourceRef)) {
        throw new Error(`sourceRef is not allowed by whitelist: "${input.sourceRef}"`);
      }
      const fileUrl =
        `${normalizeHost(config.endpoint)}/` +
        `${encodePathSegment(config.model)}/resolve/main/${encodePathSegment(input.sourceRef)}`;
      const response = await fetchFn(fileUrl, {
        headers: buildRangeHeaders(input.offset, input.length),
      });
      if (!response.ok) {
        throw new Error(
          `Failed to read model file: ${response.status} ${response.statusText}`,
        );
      }
      if (!response.body) {
        throw new Error("Failed to read model file: empty response body");
      }
      return response.body;
    },
  };
}

function buildRangeHeaders(
  offset?: number,
  length?: number,
): Record<string, string> | undefined {
  const hasOffset = typeof offset === "number";
  const hasLength = typeof length === "number";
  if (!hasOffset && !hasLength) {
    return undefined;
  }
  if (hasOffset && (!Number.isFinite(offset) || offset! < 0)) {
    throw new Error("createReadStream offset must be a non-negative number");
  }
  if (hasLength && (!Number.isFinite(length) || length! <= 0)) {
    throw new Error("createReadStream length must be a positive number");
  }
  const start = hasOffset ? Math.floor(offset!) : 0;
  if (hasLength) {
    const end = start + Math.floor(length!) - 1;
    return { Range: `bytes=${start}-${end}` };
  }
  return { Range: `bytes=${start}-` };
}

function parseMountConfig(mount: VfsMount): { endpoint: string; model: string } {
  const endpoint = pickOptionalNonEmptyString(mount.providerExtra, "endpoint");
  const model = pickNonEmptyString(mount.providerExtra, "model");
  return { endpoint: endpoint ?? DEFAULT_HUGGINGFACE_ENDPOINT, model };
}

function pickOptionalNonEmptyString(
  value: Record<string, unknown>,
  key: "endpoint",
): string | undefined {
  const got = value[key];
  if (typeof got === "undefined") {
    return undefined;
  }
  if (typeof got !== "string" || got.trim().length === 0) {
    throw new Error(`providerExtra.${key} must be a non-empty string`);
  }
  return got.trim();
}

function pickNonEmptyString(
  value: Record<string, unknown>,
  key: "endpoint" | "model",
): string {
  const got = value[key];
  if (typeof got !== "string" || got.trim().length === 0) {
    throw new Error(`providerExtra.${key} must be a non-empty string`);
  }
  return got.trim();
}

function normalizeHost(host: string): string {
  return host.replace(/\/+$/, "");
}

function parseCursorOffset(cursor?: string): number {
  if (!cursor) {
    return 0;
  }
  const offset = Number(cursor);
  if (!Number.isFinite(offset) || offset < 0) {
    return 0;
  }
  return Math.floor(offset);
}

function encodePathSegment(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildListItems(
  siblings: Array<{ rfilename?: string; size?: number }>,
): ListChildrenItem[] {
  const byKey = new Map<string, ListChildrenItem>();
  for (const sibling of siblings) {
    if (typeof sibling.rfilename !== "string" || sibling.rfilename.length === 0) {
      continue;
    }
    if (!isWhitelistedFile(sibling.rfilename)) {
      continue;
    }
    const parts = sibling.rfilename.split("/").filter((part) => part.length > 0);
    if (parts.length === 0) {
      continue;
    }
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i]!;
      const sourceRef = parts.slice(0, i + 1).join("/");
      const parentSourceRef = i === 0 ? null : parts.slice(0, i).join("/");
      const key = `folder|${parentSourceRef ?? ""}|${name}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          sourceRef,
          parentSourceRef,
          name,
          kind: "folder",
        });
      }
    }
    const fileName = parts[parts.length - 1]!;
    const fileParent = parts.length > 1 ? parts.slice(0, parts.length - 1).join("/") : null;
    const fileRef = parts.join("/");
    const fileKey = `file|${fileParent ?? ""}|${fileName}`;
    if (!byKey.has(fileKey)) {
      byKey.set(fileKey, {
        sourceRef: fileRef,
        parentSourceRef: fileParent,
        name: fileName,
        kind: "file",
        size:
          Number.isFinite(sibling.size) && (sibling.size ?? 0) >= 0
            ? Number(sibling.size)
            : undefined,
      });
    }
  }
  return [...byKey.values()];
}

function isWhitelistedFile(sourceRef: string): boolean {
  return (
    HUGGINGFACE_FILE_WHITELIST.has(sourceRef) ||
    sourceRef === "onnx/model.onnx" ||
    sourceRef.startsWith("onnx/model.onnx")
  );
}
