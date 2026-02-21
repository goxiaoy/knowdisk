import { expect, test } from "bun:test";
import { createIndexingService } from "./indexing.service";

test("scheduled reconcile repairs missing chunk", async () => {
  const fakeDeps = {
    pipeline: {
      async rebuild(reason: string) {
        return { reason };
      },
      async incremental(changes: Array<{ path: string; type: string }>) {
        return { changes };
      },
      async reconcile() {
        return { repaired: 1 };
      },
      status() {
        return { state: "idle" as const };
      },
    },
    vectorRepo: {
      async deleteByChunkId(_chunkId: string) {
        return;
      },
    },
  };

  const svc = createIndexingService(fakeDeps);
  await svc.runFullRebuild("test");
  await fakeDeps.vectorRepo.deleteByChunkId("a.md#0#123");
  const report = await svc.runScheduledReconcile();
  expect(report.repaired).toBeGreaterThan(0);
});
