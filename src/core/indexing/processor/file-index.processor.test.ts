import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIndexMetadataRepository } from "../metadata/index-metadata.repository";
import { createFileIndexProcessor } from "./file-index.processor";
import type { Parser } from "../../parser/parser.types";
import { createChunkingService } from "../chunker/chunker.service";

const parser: Parser = {
  id: "text",
  async *parseStream(input: AsyncIterable<string>) {
    let offset = 0;
    for await (const chunk of input) {
      yield {
        text: chunk,
        startOffset: offset,
        endOffset: offset + chunk.length,
        tokenEstimate: Math.max(1, Math.floor(chunk.length / 4)),
      };
      offset += chunk.length;
    }
  },
  async readRange(path, startOffset, endOffset) {
    return readFileSync(path, "utf8").slice(startOffset, endOffset);
  },
};

describe("file index processor", () => {
  const chunking = createChunkingService({
    sizeChars: 1200,
    overlapChars: 200,
    charsPerToken: 4,
  });

  test("skips unchanged indexed file by mtime and size", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-file-processor-"));
    const dbPath = join(dir, "index.db");
    const filePath = join(dir, "a.txt");
    writeFileSync(filePath, "alpha");

    let upsertCalls = 0;
    let deleteCalls = 0;
    const repo = createIndexMetadataRepository({ dbPath });
    const processor = createFileIndexProcessor({
      embedding: { async embed() { return [1, 2, 3]; } },
      chunking,
      vector: {
        async upsert(rows) {
          upsertCalls += rows.length;
        },
        async deleteBySourcePath() {
          deleteCalls += 1;
        },
      },
      metadata: repo,
    });

    const first = await processor.indexFile(filePath, parser);
    const second = await processor.indexFile(filePath, parser);

    expect(first.skipped).toBe(false);
    expect(first.indexedChunks).toBe(1);
    expect(second.skipped).toBe(true);
    expect(upsertCalls).toBe(1);
    expect(deleteCalls).toBe(0);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("replaces vector rows when file content changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-file-processor-"));
    const dbPath = join(dir, "index.db");
    const filePath = join(dir, "a.txt");
    writeFileSync(filePath, "alpha");

    const calls: { upsert: number[]; delete: string[] } = { upsert: [], delete: [] };
    const repo = createIndexMetadataRepository({ dbPath });
    const processor = createFileIndexProcessor({
      embedding: { async embed(text) { return [text.length]; } },
      chunking,
      vector: {
        async upsert(rows) {
          calls.upsert.push(rows.length);
        },
        async deleteBySourcePath(path) {
          calls.delete.push(path);
        },
      },
      metadata: repo,
    });

    await processor.indexFile(filePath, parser);
    writeFileSync(filePath, "beta");
    const result = await processor.indexFile(filePath, parser);

    expect(result.skipped).toBe(false);
    expect(result.indexedChunks).toBe(1);
    expect(calls.delete).toEqual([filePath]);
    expect(calls.upsert.length).toBe(2);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("deleteFile clears chunks and marks file as deleted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-file-processor-"));
    const dbPath = join(dir, "index.db");
    const filePath = join(dir, "a.txt");
    writeFileSync(filePath, "alpha");

    let deleteCalls = 0;
    const repo = createIndexMetadataRepository({ dbPath });
    const processor = createFileIndexProcessor({
      embedding: { async embed() { return [1]; } },
      chunking,
      vector: {
        async upsert() {},
        async deleteBySourcePath() {
          deleteCalls += 1;
        },
      },
      metadata: repo,
    });

    await processor.indexFile(filePath, parser);
    await processor.deleteFile(filePath);

    const fileRow = repo.getFileByPath(filePath);
    expect(deleteCalls).toBe(1);
    expect(fileRow?.status).toBe("deleted");
    expect(fileRow?.lastError).toBeNull();
    expect(repo.searchFts("alpha", 10).length).toBe(0);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("uses unified chunking strategy in stream pipeline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-file-processor-"));
    const dbPath = join(dir, "index.db");
    const filePath = join(dir, "sample.txt");
    const text = "x".repeat(2500);
    writeFileSync(filePath, text);

    const repo = createIndexMetadataRepository({ dbPath });
    const calls: Array<{ count: number; starts: number[] }> = [];
    const processor = createFileIndexProcessor({
      embedding: { async embed(input) { return [input.length]; } },
      chunking,
      vector: {
        async upsert(rows) {
          calls.push({
            count: rows.length,
            starts: rows
              .map((row) => row.metadata.startOffset ?? -1)
              .filter((value) => value >= 0),
          });
        },
        async deleteBySourcePath() {},
      },
      metadata: repo,
    });

    await processor.indexFile(filePath, parser);

    expect(calls.length).toBe(1);
    expect(calls[0]!.count).toBeGreaterThan(1);
    expect(calls[0]!.starts).toContain(0);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
