import { expect, test } from "bun:test";
import { createIndexingService } from "./indexing.service";

test("scheduled reconcile repairs missing chunk", async () => {
  const vectorRepo = {
    async deleteByChunkId(_chunkId: string) {
      return;
    },
  };

  const svc = createIndexingService(
    async (reason: string) => ({ reason }),
    async (changes: Array<{ path: string; type: string }>) => ({ changes }),
    async () => ({ repaired: 1 }),
    () => ({ state: "idle" as const }),
  );
  await svc.runFullRebuild("test");
  await vectorRepo.deleteByChunkId("a.md#0#123");
  const report = await svc.runScheduledReconcile();
  expect(report.repaired).toBeGreaterThan(0);
});
