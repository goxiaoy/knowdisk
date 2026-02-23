import { describe, expect, test } from "bun:test";
import { createIndexJobScheduler } from "./index-job.scheduler";

describe("index job scheduler", () => {
  test("coalesces repeated changes into one index job", () => {
    const enqueued: Array<{ path: string; jobType: string; reason: string }> = [];
    const scheduler = createIndexJobScheduler(
      {
        enqueueJob(job) {
          enqueued.push({ path: job.path, jobType: job.jobType, reason: job.reason });
        },
      },
      { debounceMs: 500 },
    );

    scheduler.onFsEvent("/docs/a.md", "change", 1000);
    scheduler.onFsEvent("/docs/a.md", "change", 1200);
    scheduler.onFsEvent("/docs/a.md", "change", 1300);

    expect(scheduler.flushDue(1700)).toBe(0);
    expect(scheduler.flushDue(1801)).toBe(1);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ path: "/docs/a.md", jobType: "index" });
  });

  test("unlink overrides pending index and schedules delete", () => {
    const enqueued: Array<{ path: string; jobType: string; reason: string }> = [];
    const scheduler = createIndexJobScheduler(
      {
        enqueueJob(job) {
          enqueued.push({ path: job.path, jobType: job.jobType, reason: job.reason });
        },
      },
      { debounceMs: 500 },
    );

    scheduler.onFsEvent("/docs/a.md", "change", 1000);
    scheduler.onFsEvent("/docs/a.md", "unlink", 1100);

    expect(scheduler.flushDue(1601)).toBe(1);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ path: "/docs/a.md", jobType: "delete", reason: "watcher_unlink" });
  });

  test("keeps delete intent when add/change follows unlink", () => {
    const enqueued: Array<{ path: string; jobType: string; reason: string }> = [];
    const scheduler = createIndexJobScheduler(
      {
        enqueueJob(job) {
          enqueued.push({ path: job.path, jobType: job.jobType, reason: job.reason });
        },
      },
      { debounceMs: 300 },
    );

    scheduler.onFsEvent("/docs/a.md", "unlink", 1000);
    scheduler.onFsEvent("/docs/a.md", "add", 1100);
    scheduler.onFsEvent("/docs/a.md", "change", 1200);

    expect(scheduler.flushDue(1501)).toBe(1);
    expect(enqueued[0]).toMatchObject({ path: "/docs/a.md", jobType: "delete" });
  });
});
