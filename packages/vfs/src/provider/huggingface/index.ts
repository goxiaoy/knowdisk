import type { VfsProviderAdapter } from "../../vfs.provider.types";
import type { ListChildrenItem } from "../../vfs.service.types";
import type { VfsMount } from "../../vfs.types";
import pino, { type Logger } from "pino";

type HuggingFaceRepoResponse = {
  siblings?: Array<{ rfilename?: string; size?: number }>;
};

type CreateHuggingFaceVfsProviderDeps = {
  fetch?: typeof fetch;
  logger?: Logger;
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
  const logger =
    deps?.logger ??
    pino({
      name: "knowdisk.vfs.provider.huggingface",
    });
  return {
    type: "huggingface",
    capabilities: { watch: false },
    async listChildren(input) {
      const config = parseMountConfig(input.mount);
      logger.info(
        {
          mountId: input.mount.mountId,
          model: config.model,
          parentSourceRef: input.parentSourceRef,
          limit: input.limit,
          cursor: input.cursor,
        },
        "huggingface listChildren",
      );
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
      logger.info(
        {
          mountId: input.mount.mountId,
          model: config.model,
          sourceRef: input.sourceRef,
          offset: input.offset,
          length: input.length,
        },
        "huggingface createReadStream",
      );
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
    async getMetadata(input) {
      const config = parseMountConfig(input.mount);
      logger.info(
        {
          mountId: input.mount.mountId,
          model: config.model,
          sourceRef: input.sourceRef,
        },
        "huggingface getMetadata",
      );
      if (!isWhitelistedFile(input.sourceRef)) {
        return null;
      }
      const apiUrl = `${normalizeHost(config.endpoint)}/api/models/${encodePathSegment(config.model)}`;
      const response = await fetchFn(apiUrl);
      if (!response.ok) {
        throw new Error(
          `Failed to list model files: ${response.status} ${response.statusText}`,
        );
      }
      const payload = (await response.json()) as HuggingFaceRepoResponse;
      const found = (payload.siblings ?? []).find(
        (item) => item.rfilename === input.sourceRef,
      );
      if (!found) {
        return null;
      }
      const fileUrl =
        `${normalizeHost(config.endpoint)}/` +
        `${encodePathSegment(config.model)}/resolve/main/${encodePathSegment(input.sourceRef)}`;
      const probedSize = await probeRemoteFileSize(fetchFn, fileUrl);
      const size =
        probedSize > 0
          ? probedSize
          : Number.isFinite(found.size) && (found.size ?? 0) >= 0
            ? Number(found.size)
            : undefined;
      logger.info(
        {
          mountId: input.mount.mountId,
          sourceRef: input.sourceRef,
          size: size ?? 0,
        },
        "huggingface getMetadata resolved",
      );
      return toListChildrenItem(found.rfilename!, size);
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

async function probeRemoteFileSize(fetchFn: typeof fetch, fileUrl: string): Promise<number> {
  try {
    const head = await fetchFn(fileUrl, { method: "HEAD" });
    if (head.ok) {
      const len = Number(head.headers.get("content-length") ?? "0");
      if (Number.isFinite(len) && len > 0) {
        return len;
      }
    }
  } catch {
    // ignore and fallback to range probe
  }
  try {
    const ranged = await fetchFn(fileUrl, { headers: { Range: "bytes=0-0" } });
    const fromRange = parseContentRangeTotal(ranged.headers.get("content-range"));
    if (fromRange && fromRange > 0) {
      return fromRange;
    }
    const len = Number(ranged.headers.get("content-length") ?? "0");
    if (Number.isFinite(len) && len > 0) {
      return len;
    }
  } catch {
    return 0;
  }
  return 0;
}

function parseContentRangeTotal(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const match = /bytes\s+\d+-\d+\/(\d+)/i.exec(value);
  if (!match) {
    return null;
  }
  const total = Number(match[1]);
  return Number.isFinite(total) ? total : null;
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
    const fileKey = `file|${fileParent ?? ""}|${fileName}`;
    if (!byKey.has(fileKey)) {
      byKey.set(fileKey, toListChildrenItem(sibling.rfilename, sibling.size));
    }
  }
  return [...byKey.values()];
}

function toListChildrenItem(sourceRef: string, size?: number): ListChildrenItem {
  const parts = sourceRef.split("/").filter((part) => part.length > 0);
  const name = parts[parts.length - 1] ?? sourceRef;
  const parentSourceRef = parts.length > 1 ? parts.slice(0, parts.length - 1).join("/") : null;
  return {
    sourceRef,
    parentSourceRef,
    name,
    kind: "file",
    size: Number.isFinite(size) && (size ?? 0) >= 0 ? Number(size) : undefined,
  };
}

function isWhitelistedFile(sourceRef: string): boolean {
  return (
    HUGGINGFACE_FILE_WHITELIST.has(sourceRef) ||
    sourceRef === "onnx/model.onnx" ||
    sourceRef.startsWith("onnx/model.onnx")
  );
}
