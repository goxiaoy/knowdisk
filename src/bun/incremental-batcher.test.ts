import { describe, expect, test } from "bun:test";
import { createIncrementalBatcher } from "./incremental-batcher";

describe("incremental batcher", () => {
  test("batches multiple file events and calls runIncremental once", async () => {
    const calls: Array<Array<{ path: string; type: string }>> = [];
    const batcher = createIncrementalBatcher({
      debounceMs: 10_000,
      runIncremental: async (changes) => {
        calls.push(changes.map((row) => ({ ...row })));
      },
    });

    batcher.enqueue("/docs/a.md", "change");
    batcher.enqueue("/docs/b.md", "add");
    batcher.enqueue("/docs/a.md", "unlink");

    await batcher.flushNow();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.length).toBe(2);
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        { path: "/docs/a.md", type: "unlink" },
        { path: "/docs/b.md", type: "add" },
      ]),
    );

    batcher.dispose();
  });

  test("reports error through onError and keeps running", async () => {
    const errors: string[] = [];
    let runs = 0;
    const batcher = createIncrementalBatcher({
      debounceMs: 10_000,
      runIncremental: async () => {
        runs += 1;
        if (runs === 1) {
          throw new Error("boom");
        }
      },
      onError(error) {
        errors.push(String(error));
      },
    });

    batcher.enqueue("/docs/a.md", "change");
    await batcher.flushNow();

    batcher.enqueue("/docs/b.md", "change");
    await batcher.flushNow();

    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("boom");
    expect(runs).toBe(2);

    batcher.dispose();
  });
});
