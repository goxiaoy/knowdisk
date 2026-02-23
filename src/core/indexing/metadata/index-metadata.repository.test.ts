import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIndexMetadataRepository } from "./index-metadata.repository";

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-index-meta-"));
  const dbPath = join(dir, "index.db");
  const repo = createIndexMetadataRepository({ dbPath });
  return { dir, repo };
}

describe("index metadata repository", () => {
  test("initializes schema and version", () => {
    const { dir, repo } = makeRepo();
    expect(repo.getSchemaVersion()).toBe(1);
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("upserts and gets file rows", () => {
    const { dir, repo } = makeRepo();
    repo.upsertFile({
      fileId: "f1",
      path: "/docs/a.md",
      size: 100,
      mtimeMs: 123,
      inode: 1,
      status: "indexed",
      lastIndexTimeMs: 200,
      lastError: null,
      createdAtMs: 10,
      updatedAtMs: 20,
    });

    const row = repo.getFileByPath("/docs/a.md");
    expect(row).not.toBeNull();
    expect(row?.fileId).toBe("f1");
    expect(row?.size).toBe(100);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("upserts, lists and deletes chunk rows", () => {
    const { dir, repo } = makeRepo();
    repo.upsertFile({
      fileId: "f1",
      path: "/docs/a.md",
      size: 100,
      mtimeMs: 123,
      inode: 1,
      status: "indexed",
      lastIndexTimeMs: 200,
      lastError: null,
      createdAtMs: 10,
      updatedAtMs: 20,
    });
    repo.upsertChunks([
      {
        chunkId: "c1",
        fileId: "f1",
        sourcePath: "/docs/a.md",
        startOffset: 0,
        endOffset: 10,
        chunkHash: "h1",
        tokenCount: 4,
        updatedAtMs: 100,
      },
      {
        chunkId: "c2",
        fileId: "f1",
        sourcePath: "/docs/a.md",
        startOffset: 11,
        endOffset: 20,
        chunkHash: "h2",
        tokenCount: 4,
        updatedAtMs: 101,
      },
    ]);

    const beforeDelete = repo.listChunksByFileId("f1");
    expect(beforeDelete.map((row) => row.chunkId)).toEqual(["c1", "c2"]);

    repo.deleteChunksByIds(["c1"]);
    const afterDelete = repo.listChunksByFileId("f1");
    expect(afterDelete.map((row) => row.chunkId)).toEqual(["c2"]);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("upserts, searches and deletes fts chunk rows", () => {
    const { dir, repo } = makeRepo();
    repo.upsertFtsChunks([
      {
        chunkId: "c1",
        fileId: "f1",
        sourcePath: "/docs/a.md",
        text: "knowdisk retrieval architecture",
      },
      {
        chunkId: "c2",
        fileId: "f2",
        sourcePath: "/docs/b.md",
        text: "random unrelated text",
      },
    ]);

    const rows = repo.searchFts("knowdisk", 10);
    expect(rows.length).toBe(1);
    expect(rows[0]?.chunkId).toBe("c1");

    repo.deleteFtsChunksByIds(["c1"]);
    expect(repo.searchFts("knowdisk", 10).length).toBe(0);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("enqueues, claims, completes and fails jobs", () => {
    const { dir, repo } = makeRepo();
    repo.enqueueJob({
      jobId: "j1",
      path: "/docs/a.md",
      jobType: "index",
      reason: "watcher_change",
      nextRunAtMs: 10,
    });
    repo.enqueueJob({
      jobId: "j2",
      path: "/docs/b.md",
      jobType: "delete",
      reason: "watcher_unlink",
      nextRunAtMs: 10,
    });

    const claimed = repo.claimDueJobs(5, 20);
    expect(claimed.length).toBe(2);
    expect(claimed.every((job) => job.status === "running")).toBe(true);

    repo.completeJob("j1");
    repo.failJob("j2", "boom");
    repo.retryJob("j2", "retrying", 999);
    const retried = repo.getJobById("j2");
    expect(retried?.status).toBe("pending");
    expect(retried?.nextRunAtMs).toBe(999);

    const none = repo.claimDueJobs(5, 20);
    expect(none.length).toBe(0);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("resets running jobs to pending", () => {
    const { dir, repo } = makeRepo();
    repo.enqueueJob({
      jobId: "j1",
      path: "/docs/a.md",
      jobType: "index",
      reason: "startup_recovery",
      nextRunAtMs: 10,
    });

    expect(repo.claimDueJobs(1, 10).length).toBe(1);
    expect(repo.resetRunningJobsToPending()).toBe(1);
    expect(repo.claimDueJobs(1, 10).length).toBe(1);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
