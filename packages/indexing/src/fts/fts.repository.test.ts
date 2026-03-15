import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createFtsRepository } from "./fts.repository";
import type { FtsChunkRow } from "./fts.repository.types";

describe("fts repository", () => {
  test("schema bootstraps in sqlite", () => {
    const { dir, dbPath, repo } = makeRepo();
    repo.close();

    const db = new Database(dbPath, { readonly: true });
    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table') ORDER BY name"
      )
      .all() as Array<{ name: string }>;
    const columns = db.query("PRAGMA table_info(index_chunks)").all() as Array<{ name: string }>;

    expect(tables.map((item) => item.name)).toContain("index_chunks");
    expect(tables.map((item) => item.name)).toContain("index_chunks_fts");
    expect(columns.map((item) => item.name)).toContain("source_ref");
    expect(columns.map((item) => item.name)).toContain("parser_version");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("upserts rows for one node", async () => {
    const { dir, repo } = makeRepo();

    await repo.replaceNodeChunks([
      createRow({ chunkId: "chunk-1", nodeId: "node-1", text: "alpha" }),
      createRow({ chunkId: "chunk-2", nodeId: "node-1", text: "beta" }),
    ]);

    const rows = await repo.search("alpha OR beta", { topK: 10 });
    expect(rows.map((item) => item.chunkId).sort()).toEqual(["chunk-1", "chunk-2"]);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("deletes rows by nodeId", async () => {
    const { dir, repo } = makeRepo();

    await repo.replaceNodeChunks([
      createRow({ chunkId: "chunk-1", nodeId: "node-1", text: "alpha" }),
      createRow({ chunkId: "chunk-2", nodeId: "node-2", text: "beta" }),
    ]);
    await repo.deleteByNodeId("node-1");

    const rows = await repo.search("alpha OR beta", { topK: 10 });
    expect(rows.map((item) => item.chunkId)).toEqual(["chunk-2"]);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("full-text query search", async () => {
    const { dir, repo } = makeRepo();

    await repo.replaceNodeChunks([
      createRow({
        chunkId: "chunk-1",
        text: "alpha indexing sqlite",
        title: "Indexing guide",
      }),
      createRow({
        chunkId: "chunk-2",
        text: "vector embeddings only",
        title: "Embeddings guide",
      }),
    ]);

    const rows = await repo.search("sqlite", { topK: 5 });
    expect(rows[0]?.chunkId).toBe("chunk-1");
    expect(rows[0]?.scores.fts).toBeNumber();

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("title-only query search on title/name/sourceRef", async () => {
    const { dir, repo } = makeRepo();

    await repo.replaceNodeChunks([
      createRow({
        chunkId: "chunk-1",
        title: "Alpha title",
        name: "notes.md",
        sourceRef: "docs/alpha.md",
        text: "irrelevant body",
      }),
      createRow({
        chunkId: "chunk-2",
        title: "Other title",
        name: "sqlite.md",
        sourceRef: "docs/other.md",
        text: "also irrelevant",
      }),
    ]);

    expect((await repo.search("alpha", { topK: 5, titleOnly: true }))[0]?.chunkId).toBe("chunk-1");
    expect((await repo.search("sqlite", { topK: 5, titleOnly: true }))[0]?.chunkId).toBe("chunk-2");
    expect(await repo.search("irrelevant", { topK: 5, titleOnly: true })).toHaveLength(0);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-indexing-fts-"));
  const dbPath = join(dir, "indexing.db");
  const repo = createFtsRepository({ dbPath });
  return { dir, dbPath, repo };
}

function createRow(overrides: Partial<FtsChunkRow> = {}): FtsChunkRow {
  return {
    chunkId: overrides.chunkId ?? "chunk-1",
    nodeId: overrides.nodeId ?? "node-1",
    mountId: overrides.mountId ?? "mount-1",
    sourceRef: overrides.sourceRef ?? "docs/readme.md",
    name: overrides.name ?? "readme.md",
    title: overrides.title ?? "Readme",
    heading: overrides.heading ?? "Overview",
    sectionId: overrides.sectionId ?? "section-1",
    sectionPath: overrides.sectionPath ?? ["Overview"],
    text: overrides.text ?? "knowdisk readme body",
    markdown: overrides.markdown ?? "# Readme",
    chunkIndex: overrides.chunkIndex ?? 0,
    tokenEstimate: overrides.tokenEstimate ?? 4,
    charStart: overrides.charStart ?? 0,
    charEnd: overrides.charEnd ?? 20,
    providerVersion: overrides.providerVersion ?? "rev-1",
    parserId: overrides.parserId ?? "parser",
    parserVersion: overrides.parserVersion ?? "1.0.0",
    converterId: overrides.converterId ?? "converter",
    converterVersion: overrides.converterVersion ?? "1.0.0",
    updatedAt: overrides.updatedAt ?? "2026-03-15T00:00:00.000Z",
  };
}
