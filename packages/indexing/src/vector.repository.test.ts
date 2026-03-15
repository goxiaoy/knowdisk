import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVectorRepository } from "./vector.repository";
import type { VectorChunkRow } from "./vector.repository.types";

describe("vector repository", () => {
  test("initializes zvec collection", async () => {
    const { dir, collectionPath, repo } = makeRepo();

    await repo.replaceNodeChunks([createRow({ chunkId: "chunk-1", embedding: [1, 0] })]);

    expect(existsSync(collectionPath)).toBe(true);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("upserts rows", async () => {
    const { dir, repo } = makeRepo();

    await repo.replaceNodeChunks([
      createRow({ chunkId: "chunk-1", embedding: [1, 0], text: "alpha" }),
      createRow({ chunkId: "chunk-2", embedding: [0, 1], text: "beta" }),
    ]);

    const rows = await repo.search([1, 0], { topK: 2 });
    expect(rows[0]?.chunkId).toBe("chunk-1");
    expect(rows.some((item) => item.chunkId === "chunk-2")).toBe(true);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("deletes rows by nodeId", async () => {
    const { dir, repo } = makeRepo();

    await repo.replaceNodeChunks([
      createRow({ chunkId: "chunk-1", nodeId: "node-1", embedding: [1, 0] }),
      createRow({ chunkId: "chunk-2", nodeId: "node-2", embedding: [0, 1] }),
    ]);
    await repo.deleteByNodeId("node-1");

    const rows = await repo.search([1, 0], { topK: 5 });
    expect(rows.map((item) => item.chunkId)).toEqual(["chunk-2"]);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("searches by query vector", async () => {
    const { dir, repo } = makeRepo();

    await repo.replaceNodeChunks([
      createRow({ chunkId: "chunk-1", embedding: [1, 0], text: "alpha" }),
      createRow({ chunkId: "chunk-2", embedding: [0, 1], text: "beta" }),
    ]);

    const rows = await repo.search([0, 1], { topK: 1 });
    expect(rows[0]?.chunkId).toBe("chunk-2");
    expect(rows[0]?.scores.vector).toBeNumber();

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("rejects mixed embedding dimensions", async () => {
    const { dir, repo } = makeRepo();

    await expect(
      repo.replaceNodeChunks([
        createRow({ chunkId: "chunk-1", embedding: [1, 0] }),
        createRow({ chunkId: "chunk-2", embedding: [1, 0, 0] }),
      ]),
    ).rejects.toThrow("Mixed embedding dimensions are not supported");

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-indexing-zvec-"));
  const collectionPath = join(dir, "vectors.zvec");
  const repo = createVectorRepository({ collectionPath });
  return { dir, collectionPath, repo };
}

function createRow(overrides: Partial<VectorChunkRow> = {}): VectorChunkRow {
  return {
    chunkId: overrides.chunkId ?? "chunk-1",
    nodeId: overrides.nodeId ?? "node-1",
    mountId: overrides.mountId ?? "mount-1",
    sourceRef: overrides.sourceRef ?? "docs/readme.md",
    name: overrides.name ?? "readme.md",
    title: overrides.title ?? "Readme",
    heading: overrides.heading ?? "Overview",
    text: overrides.text ?? "knowdisk readme body",
    chunkIndex: overrides.chunkIndex ?? 0,
    sectionPath: overrides.sectionPath ?? ["Overview"],
    charStart: overrides.charStart ?? 0,
    charEnd: overrides.charEnd ?? 20,
    tokenEstimate: overrides.tokenEstimate ?? 4,
    updatedAt: overrides.updatedAt ?? "2026-03-15T00:00:00.000Z",
    embedding: overrides.embedding ?? [1, 0],
  };
}
