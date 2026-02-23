import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import { stat } from "node:fs/promises";
import type { IndexChunkRow } from "../metadata/index-metadata.repository.types";
import type { ChunkDiff, ChunkSpan, FileIndexProcessor, FileIndexProcessorDeps } from "./file-index.processor.types";
import type { Parser } from "../../parser/parser.types";

const VECTOR_PREVIEW_CHARS = 200;

export function createFileIndexProcessor(deps: FileIndexProcessorDeps): FileIndexProcessor {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const makeFileId = deps.makeFileId ?? defaultMakeFileId;
  const makeChunkId = deps.makeChunkId ?? defaultMakeChunkId;

  return {
    async indexFile(path: string, parser: Parser) {
      const fileStat = await stat(path);
      const existing = deps.metadata.getFileByPath(path);
      if (
        existing &&
        existing.status === "indexed" &&
        existing.size === fileStat.size &&
        existing.mtimeMs === fileStat.mtimeMs
      ) {
        return { skipped: true, indexedChunks: 0 };
      }

      const fileId = existing?.fileId ?? makeFileId(path);
      const startedAt = nowMs();
      deps.metadata.upsertFile({
        fileId,
        path,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        inode: toNullableNumber((fileStat as unknown as { ino?: number }).ino),
        status: "indexing",
        lastIndexTimeMs: existing?.lastIndexTimeMs ?? null,
        lastError: null,
        createdAtMs: existing?.createdAtMs ?? startedAt,
        updatedAtMs: startedAt,
      });

      const spans = await parseFile(path, parser, deps);
      const previous = deps.metadata.listChunksByFileId(fileId);
      const diff = buildDiff(spans, previous);
      const previousChunkIds = previous.map((row) => row.chunkId);

      const upsertRows = await buildVectorAndMetadataRows(
        diff.hasStructuralChange ? diff.all : diff.changedOrNew,
        fileId,
        path,
        makeChunkId,
        deps,
      );

      if (diff.hasStructuralChange) {
        await deps.vector.deleteBySourcePath(path);
        if (previousChunkIds.length > 0) {
          deps.metadata.deleteChunksByIds(previousChunkIds);
          deps.metadata.deleteFtsChunksByIds(previousChunkIds);
        }
      } else if (diff.removedChunkIds.length > 0) {
        deps.metadata.deleteChunksByIds(diff.removedChunkIds);
        deps.metadata.deleteFtsChunksByIds(diff.removedChunkIds);
      }

      if (upsertRows.vectorRows.length > 0) {
        await deps.vector.upsert(upsertRows.vectorRows);
        deps.metadata.upsertChunks(upsertRows.chunkRows);
        deps.metadata.upsertFtsChunks(upsertRows.ftsRows);
      }

      const finishedAt = nowMs();
      deps.metadata.upsertFile({
        fileId,
        path,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        inode: toNullableNumber((fileStat as unknown as { ino?: number }).ino),
        status: "indexed",
        lastIndexTimeMs: finishedAt,
        lastError: null,
        createdAtMs: existing?.createdAtMs ?? startedAt,
        updatedAtMs: finishedAt,
      });

      return { skipped: false, indexedChunks: upsertRows.vectorRows.length };
    },

    async deleteFile(path: string) {
      const existing = deps.metadata.getFileByPath(path);
      if (!existing) {
        return;
      }
      const oldChunks = deps.metadata.listChunksByFileId(existing.fileId);
      if (oldChunks.length > 0) {
        await deps.vector.deleteBySourcePath(path);
        const ids = oldChunks.map((row) => row.chunkId);
        deps.metadata.deleteChunksByIds(ids);
        deps.metadata.deleteFtsChunksByIds(ids);
      }
      const updatedAt = nowMs();
      deps.metadata.upsertFile({
        ...existing,
        status: "deleted",
        lastError: null,
        updatedAtMs: updatedAt,
      });
    },
  };
}

async function parseFile(
  path: string,
  parser: Parser,
  deps: FileIndexProcessorDeps,
): Promise<ChunkSpan[]> {
  const stream = createReadStream(path, { encoding: "utf8" });
  return deps.chunking.chunkParsedStream(toChunkInput(parser.parseStream(stream)));
}

function buildDiff(spans: ChunkSpan[], previous: IndexChunkRow[]): ChunkDiff {
  const prevByKey = new Map<string, IndexChunkRow>();
  for (const row of previous) {
    prevByKey.set(spanKey(row.startOffset, row.endOffset), row);
  }

  const all = spans;
  const changedOrNew: ChunkSpan[] = [];
  let hasStructuralChange = false;
  const seenKeys = new Set<string>();

  for (const span of spans) {
    const key = spanKey(span.startOffset, span.endOffset);
    seenKeys.add(key);
    const prev = prevByKey.get(key);
    if (!prev) {
      changedOrNew.push(span);
      continue;
    }
    if (prev.chunkHash !== span.chunkHash) {
      changedOrNew.push(span);
      hasStructuralChange = true;
    }
  }

  const removedChunkIds: string[] = [];
  for (const row of previous) {
    if (seenKeys.has(spanKey(row.startOffset, row.endOffset))) {
      continue;
    }
    removedChunkIds.push(row.chunkId);
    hasStructuralChange = true;
  }

  return {
    all,
    changedOrNew,
    removedChunkIds,
    hasStructuralChange,
  };
}

async function buildVectorAndMetadataRows(
  spans: ChunkSpan[],
  fileId: string,
  sourcePath: string,
  makeChunkId: (input: {
    fileId: string;
    startOffset: number | null;
    endOffset: number | null;
    chunkHash: string;
  }) => string,
  deps: FileIndexProcessorDeps,
) {
  const vectorRows = [] as Array<{
    chunkId: string;
    vector: number[];
    metadata: {
      sourcePath: string;
      title?: string;
      chunkText: string;
      startOffset?: number;
      endOffset?: number;
      tokenEstimate?: number;
      updatedAt?: string;
    };
  }>;
  const chunkRows: IndexChunkRow[] = [];
  const ftsRows: Array<{ chunkId: string; fileId: string; sourcePath: string; title: string; text: string }> = [];
  const title = fileTitleFromPath(sourcePath);

  const updatedAtMs = Date.now();
  for (const span of spans) {
    const chunkId = makeChunkId({
      fileId,
      startOffset: span.startOffset,
      endOffset: span.endOffset,
      chunkHash: span.chunkHash,
    });
    const vector = await deps.embedding.embed(span.text);
    vectorRows.push({
      chunkId,
      vector,
      metadata: {
        sourcePath,
        title,
        chunkText: toPreview(span.text),
        startOffset: span.startOffset ?? undefined,
        endOffset: span.endOffset ?? undefined,
        tokenEstimate: span.tokenCount ?? undefined,
        updatedAt: new Date(updatedAtMs).toISOString(),
      },
    });
    chunkRows.push({
      chunkId,
      fileId,
      sourcePath,
      startOffset: span.startOffset,
      endOffset: span.endOffset,
      chunkHash: span.chunkHash,
      tokenCount: span.tokenCount,
      updatedAtMs,
    });
    ftsRows.push({
      chunkId,
      fileId,
      sourcePath,
      title,
      text: span.text,
    });
  }

  return { vectorRows, chunkRows, ftsRows };
}

async function* toChunkInput(
  input: AsyncIterable<{
    text: string;
    startOffset: number;
    skipped?: string;
  }>,
) {
  for await (const parsed of input) {
    if (parsed.skipped || !parsed.text.trim()) {
      continue;
    }
    yield {
      text: parsed.text,
      startOffset: parsed.startOffset,
    };
  }
}

function spanKey(startOffset: number | null, endOffset: number | null) {
  return `${startOffset ?? ""}#${endOffset ?? ""}`;
}

function defaultMakeFileId(path: string) {
  return `file_${createHash("sha256").update(path).digest("hex")}`;
}

function defaultMakeChunkId(input: {
  fileId: string;
  startOffset: number | null;
  endOffset: number | null;
  chunkHash: string;
}) {
  const key = `${input.fileId}#${input.startOffset ?? ""}#${input.endOffset ?? ""}#${input.chunkHash}`;
  return `c_${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

function fileTitleFromPath(path: string) {
  const base = basename(path);
  const ext = extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toPreview(text: string) {
  if (text.length <= VECTOR_PREVIEW_CHARS) {
    return text;
  }
  return `${text.slice(0, VECTOR_PREVIEW_CHARS)}...`;
}
