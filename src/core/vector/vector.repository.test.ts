import { expect, test } from "bun:test";
import { createVectorRepository } from "./vector.repository";

test("upserts and searches top-k", async () => {
  const repo = createVectorRepository();
  await repo.upsert([{ chunkId: "a", vector: [1, 0], metadata: { sourcePath: "a.md" } }]);
  const results = await repo.search([1, 0], { topK: 1 });
  expect(results[0]?.chunkId).toBe("a");
});
