import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIndexMetadataRepository } from "../metadata/index-metadata.repository";
import { createIndexWorker } from "./index-worker";

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-index-worker-"));
  const dbPath = join(dir, "index.db");
  const repo = createIndexMetadataRepository({ dbPath });
  return { dir, repo };
}

describe("index worker", () => {
  test("claims due jobs with concurrency cap", async () => {
    const { dir, repo } = makeRepo();
    repo.enqueueJob({ jobId: "j1", path: "/docs/a.txt", jobType: "index", reason: "test", nextRunAtMs: 0 });
    repo.enqueueJob({ jobId: "j2", path: "/docs/b.txt", jobType: "index", reason: "test", nextRunAtMs: 0 });
    repo.enqueueJob({ jobId: "j3", path: "/docs/c.txt", jobType: "index", reason: "test", nextRunAtMs: 0 });

    let count = 0;
    const worker = createIndexWorker({
      metadata: repo,
      processor: {
        async indexFile() {
          count += 1;
          return { skipped: false, indexedChunks: 1 };
        },
        async deleteFile() {},
      },
      concurrency: 2,
      maxAttempts: 3,
      backoffMs: [1000, 5000],
    });

    const stats = await worker.runOnce(100);
    expect(stats.claimed).toBe(2);
    expect(stats.settled).toBe(2);
    expect(stats.retried).toBe(0);
    expect(count).toBe(2);
    expect(repo.getJobById("j1")?.status).toBe("done");
    expect(repo.getJobById("j2")?.status).toBe("done");
    expect(repo.getJobById("j3")?.status).toBe("pending");

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("retries failed jobs with backoff then marks failed at max attempts", async () => {
    const { dir, repo } = makeRepo();
    repo.enqueueJob({ jobId: "j1", path: "/docs/a.txt", jobType: "index", reason: "test", nextRunAtMs: 0 });

    const worker = createIndexWorker({
      metadata: repo,
      processor: {
        async indexFile() {
          throw new Error("boom");
        },
        async deleteFile() {},
      },
      concurrency: 1,
      maxAttempts: 2,
      backoffMs: [1000, 5000],
    });

    const firstStats = await worker.runOnce(100);
    expect(firstStats.claimed).toBe(1);
    expect(firstStats.settled).toBe(0);
    expect(firstStats.retried).toBe(1);
    const first = repo.getJobById("j1");
    expect(first?.status).toBe("pending");
    expect(first?.nextRunAtMs).toBe(1100);

    const waitStats = await worker.runOnce(500);
    expect(waitStats.claimed).toBe(0);
    expect(waitStats.settled).toBe(0);
    expect(waitStats.retried).toBe(0);

    const secondStats = await worker.runOnce(1100);
    expect(secondStats.claimed).toBe(1);
    expect(secondStats.settled).toBe(1);
    expect(secondStats.retried).toBe(0);
    const second = repo.getJobById("j1");
    expect(second?.status).toBe("failed");
    expect(second?.attempt).toBe(2);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("resets running jobs on start", async () => {
    const { dir, repo } = makeRepo();
    repo.enqueueJob({ jobId: "j1", path: "/docs/a.txt", jobType: "index", reason: "test", nextRunAtMs: 0 });
    expect(repo.claimDueJobs(1, 0)[0]?.status).toBe("running");

    const worker = createIndexWorker({
      metadata: repo,
      processor: {
        async indexFile() {
          return { skipped: false, indexedChunks: 1 };
        },
        async deleteFile() {},
      },
      concurrency: 1,
      maxAttempts: 3,
      backoffMs: [1000, 5000],
    });

    worker.start();
    expect(repo.getJobById("j1")?.status).toBe("pending");
    await worker.runOnce(0);
    expect(repo.getJobById("j1")?.status).toBe("done");

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
