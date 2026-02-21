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
