import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVectorRepository } from "./vector.repository";

test("upserts and searches top-k", async () => {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-zvec-"));
  const repo = createVectorRepository({
    collectionPath: join(dir, "vectors.zvec"),
    dimension: 2,
    indexType: "flat",
    metric: "ip",
  });
  await repo.upsert([{ chunkId: "a", vector: [1, 0], metadata: { sourcePath: "a.md", chunkText: "hello" } }]);
  const results = await repo.search([1, 0], { topK: 1 });
  expect(results[0]?.chunkId).toBe("a");
  rmSync(dir, { recursive: true, force: true });
});

test("deleteBySourcePath removes all chunks for a file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-zvec-"));
  const repo = createVectorRepository({
    collectionPath: join(dir, "vectors.zvec"),
    dimension: 2,
    indexType: "flat",
    metric: "ip",
  });
  await repo.upsert([
    { chunkId: "doc_a1", vector: [1, 0], metadata: { sourcePath: "a.md", chunkText: "hello 1" } },
    { chunkId: "doc_a2", vector: [1, 0], metadata: { sourcePath: "a.md", chunkText: "hello 2" } },
    { chunkId: "doc_b1", vector: [0, 1], metadata: { sourcePath: "b.md", chunkText: "world" } },
  ]);

  await repo.deleteBySourcePath("a.md");

  const results = await repo.search([1, 0], { topK: 5 });
  expect(results.some((row) => row.metadata.sourcePath === "a.md")).toBe(false);
  expect(results.some((row) => row.metadata.sourcePath === "b.md")).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});

test("inspect returns schema and stats", async () => {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-zvec-"));
  const collectionPath = join(dir, "vectors.zvec");
  const repo = createVectorRepository({
    collectionPath,
    dimension: 2,
    indexType: "flat",
    metric: "ip",
  });
  await repo.upsert([{ chunkId: "doc_a1", vector: [1, 0], metadata: { sourcePath: "a.md" } }]);

  const inspect = await repo.inspect();

  expect(inspect.path).toBe(collectionPath);
  expect(inspect.stats.docCount).toBe(1);
  expect(inspect.schema.name).toBe("knowdisk");
  expect(inspect.schema.vectors[0]?.dimension).toBe(2);
  expect(inspect.schema.fields.some((field) => field.name === "sourcePath")).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});

test("destroy clears collection data", async () => {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-zvec-"));
  const repo = createVectorRepository({
    collectionPath: join(dir, "vectors.zvec"),
    dimension: 2,
    indexType: "flat",
    metric: "ip",
  });

  await repo.upsert([{ chunkId: "doc_a1", vector: [1, 0], metadata: { sourcePath: "a.md" } }]);
  const before = await repo.inspect();
  expect(before.stats.docCount).toBe(1);

  await repo.destroy();
  const after = await repo.inspect();
  expect(after.stats.docCount).toBe(0);

  rmSync(dir, { recursive: true, force: true });
});

test("listBySourcePath returns all chunks of a file ordered by startOffset", async () => {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-zvec-"));
  const repo = createVectorRepository({
    collectionPath: join(dir, "vectors.zvec"),
    dimension: 2,
    indexType: "flat",
    metric: "ip",
  });

  await repo.upsert([
    {
      chunkId: "c2",
      vector: [1, 0],
      metadata: { sourcePath: "docs/a.md", chunkText: "two", startOffset: 10, endOffset: 20 },
    },
    {
      chunkId: "c1",
      vector: [1, 0],
      metadata: { sourcePath: "docs/a.md", chunkText: "one", startOffset: 0, endOffset: 9 },
    },
    {
      chunkId: "x1",
      vector: [0, 1],
      metadata: { sourcePath: "docs/b.md", chunkText: "other", startOffset: 0, endOffset: 3 },
    },
  ]);

  const rows = await repo.listBySourcePath("docs/a.md");
  expect(rows.map((row) => row.chunkId)).toEqual(["c1", "c2"]);
  expect(rows.every((row) => row.metadata.sourcePath === "docs/a.md")).toBe(true);

  rmSync(dir, { recursive: true, force: true });
});

test("upsert truncates stored chunkText to avoid oversized metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-zvec-"));
  const repo = createVectorRepository({
    collectionPath: join(dir, "vectors.zvec"),
    dimension: 2,
    indexType: "flat",
    metric: "ip",
  });

  const longText = "x".repeat(220);
  await repo.upsert([
    {
      chunkId: "long-1",
      vector: [1, 0],
      metadata: { sourcePath: "docs/long.md", chunkText: longText },
    },
  ]);

  const rows = await repo.listBySourcePath("docs/long.md");
  expect(rows).toHaveLength(1);
  expect(rows[0]?.metadata.chunkText.length).toBeLessThanOrEqual(123);
  expect(rows[0]?.metadata.chunkText.endsWith("...")).toBe(true);

  rmSync(dir, { recursive: true, force: true });
});
