import { describe, expect, test } from "bun:test";
import { createVfsSyncScheduler } from "./vfs.sync.scheduler";

describe("vfs sync scheduler", () => {
  test("watch events are debounced per sourceRef", async () => {
    let now = 0;
    const processed: string[] = [];
    const scheduler = createVfsSyncScheduler({
      debounceMs: 100,
      retryBackoffMs: [1000, 5000, 20000],
      nowMs: () => now,
      processMetadataUpsert: async ({ sourceRef }) => {
        processed.push(sourceRef);
      },
      processMetadataDelete: async () => {},
      reconcileMounts: [],
      runReconcile: async () => {},
    });

    await scheduler.enqueueMetadataUpsert({ mountId: "m1", sourceRef: "s1" });
    now = 50;
    await scheduler.enqueueMetadataUpsert({ mountId: "m1", sourceRef: "s1" });

    now = 99;
    await scheduler.flushDue();
    expect(processed).toHaveLength(0);

    now = 150;
    await scheduler.flushDue();
    expect(processed).toEqual(["s1"]);
  });

  test("reconcile job runs for reconcile-only providers", async () => {
    let now = 0;
    const reconciled: string[] = [];
    const scheduler = createVfsSyncScheduler({
      debounceMs: 100,
      retryBackoffMs: [1000, 5000, 20000],
      nowMs: () => now,
      processMetadataUpsert: async () => {},
      processMetadataDelete: async () => {},
      reconcileMounts: [{ mountId: "m-reconcile", intervalMs: 500 }],
      runReconcile: async (mountId) => {
        reconciled.push(mountId);
      },
    });

    now = 499;
    await scheduler.runReconcileDue();
    expect(reconciled).toHaveLength(0);

    now = 500;
    await scheduler.runReconcileDue();
    expect(reconciled).toEqual(["m-reconcile"]);
  });

  test("retries apply backoff (1s/5s/20s)", async () => {
    let now = 0;
    let attempt = 0;
    const attemptedAt: number[] = [];
    const scheduler = createVfsSyncScheduler({
      debounceMs: 0,
      retryBackoffMs: [1000, 5000, 20000],
      nowMs: () => now,
      processMetadataUpsert: async () => {
        attempt += 1;
        attemptedAt.push(now);
        if (attempt < 3) {
          throw new Error("transient");
        }
      },
      processMetadataDelete: async () => {},
      reconcileMounts: [],
      runReconcile: async () => {},
    });

    await scheduler.enqueueMetadataUpsert({ mountId: "m1", sourceRef: "retry-me" });
    await scheduler.flushDue();

    now = 999;
    await scheduler.flushDue();
    expect(attempt).toBe(1);

    now = 1000;
    await scheduler.flushDue();
    expect(attempt).toBe(2);

    now = 5999;
    await scheduler.flushDue();
    expect(attempt).toBe(2);

    now = 6000;
    await scheduler.flushDue();
    expect(attempt).toBe(3);
    expect(attemptedAt).toEqual([0, 1000, 6000]);
  });

  test("failed nodes do not block queue", async () => {
    let now = 0;
    const processed: string[] = [];
    const scheduler = createVfsSyncScheduler({
      debounceMs: 0,
      retryBackoffMs: [1000, 5000, 20000],
      nowMs: () => now,
      processMetadataUpsert: async ({ sourceRef }) => {
        if (sourceRef === "bad") {
          throw new Error("boom");
        }
        processed.push(sourceRef);
      },
      processMetadataDelete: async () => {},
      reconcileMounts: [],
      runReconcile: async () => {},
    });

    await scheduler.enqueueMetadataUpsert({ mountId: "m1", sourceRef: "bad" });
    await scheduler.enqueueMetadataUpsert({ mountId: "m1", sourceRef: "good" });
    await scheduler.flushDue();

    expect(processed).toEqual(["good"]);
  });
});
