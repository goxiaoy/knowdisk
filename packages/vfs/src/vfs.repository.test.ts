import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createVfsRepository } from "./vfs.repository";

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-repo-"));
  const dbPath = join(dir, "vfs.db");
  const repo = createVfsRepository({ dbPath });
  return { dir, dbPath, repo };
}

describe("vfs repository", () => {
  test("creates and migrates all VFS tables", () => {
    const { dir, dbPath, repo } = makeRepo();
    repo.close();

    const db = new Database(dbPath, { readonly: true });
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;

    expect(tables.map((t) => t.name)).toEqual([
      "vfs_chunks",
      "vfs_markdown_cache",
      "vfs_mounts",
      "vfs_nodes",
      "vfs_page_cache",
    ]);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("upsert/get mount", () => {
    const { dir, repo } = makeRepo();
    repo.upsertMount({
      mountId: "m1",
      mountPath: "/abc/drive",
      providerType: "google_drive",
      syncMetadata: true,
      syncContent: "lazy",
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
      lastReconcileAtMs: null,
      createdAtMs: 1,
      updatedAtMs: 1,
    });

    const mount = repo.getMountById("m1");
    expect(mount).not.toBeNull();
    expect(mount?.mountPath).toBe("/abc/drive");
    expect(mount?.syncMetadata).toBe(true);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("upsert/get/list children with stable ordering (name,node_id)", () => {
    const { dir, repo } = makeRepo();
    repo.upsertNodes([
      {
        nodeId: "n2",
        mountId: "m1",
        parentId: "p1",
        name: "b.md",
        vpath: "/abc/drive/b.md",
        kind: "file",
        title: "B",
        size: 2,
        mtimeMs: 2,
        sourceRef: "s2",
        providerVersion: "v2",
        contentHash: null,
        contentState: "missing",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      {
        nodeId: "n1",
        mountId: "m1",
        parentId: "p1",
        name: "a.md",
        vpath: "/abc/drive/a.md",
        kind: "file",
        title: "A",
        size: 1,
        mtimeMs: 1,
        sourceRef: "s1",
        providerVersion: "v1",
        contentHash: null,
        contentState: "missing",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      {
        nodeId: "n3",
        mountId: "m1",
        parentId: "p1",
        name: "a.md",
        vpath: "/abc/drive/a-copy.md",
        kind: "file",
        title: "A2",
        size: 3,
        mtimeMs: 3,
        sourceRef: "s3",
        providerVersion: "v3",
        contentHash: null,
        contentState: "missing",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);

    const page1 = repo.listChildrenPageLocal({
      mountId: "m1",
      parentId: "p1",
      limit: 2,
    });
    expect(page1.items.map((item) => item.nodeId)).toEqual(["n1", "n3"]);
    expect(page1.nextCursor).toEqual({
      lastName: "a.md",
      lastNodeId: "n3",
    });

    const page2 = repo.listChildrenPageLocal({
      mountId: "m1",
      parentId: "p1",
      limit: 2,
      cursor: page1.nextCursor ?? undefined,
    });
    expect(page2.items.map((item) => item.nodeId)).toEqual(["n2"]);
    expect(page2.nextCursor).toBeUndefined();

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("upsert/list chunks by node_id and seq", () => {
    const { dir, repo } = makeRepo();
    repo.upsertChunks([
      {
        chunkId: "c2",
        nodeId: "n1",
        seq: 2,
        markdownChunk: "chunk-2",
        tokenCount: 20,
        chunkHash: "h2",
        updatedAtMs: 2,
      },
      {
        chunkId: "c1",
        nodeId: "n1",
        seq: 1,
        markdownChunk: "chunk-1",
        tokenCount: 10,
        chunkHash: "h1",
        updatedAtMs: 1,
      },
    ]);

    const chunks = repo.listChunksByNodeId("n1");
    expect(chunks.map((c) => c.chunkId)).toEqual(["c1", "c2"]);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("save/get markdown cache", () => {
    const { dir, repo } = makeRepo();
    repo.upsertMarkdownCache({
      nodeId: "n1",
      markdownFull: "# Title",
      markdownHash: "sha256:1",
      generatedBy: "provider_export",
      updatedAtMs: 1,
    });

    const cache = repo.getMarkdownCache("n1");
    expect(cache?.markdownHash).toBe("sha256:1");

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("save/get page cache with ttl checks", () => {
    const { dir, repo } = makeRepo();
    repo.upsertPageCache({
      cacheKey: "m1::root::cursor0",
      itemsJson: "[]",
      nextCursor: "provider-cursor",
      expiresAtMs: 100,
    });

    expect(repo.getPageCacheIfFresh("m1::root::cursor0", 50)?.itemsJson).toBe("[]");
    expect(repo.getPageCacheIfFresh("m1::root::cursor0", 101)).toBeNull();

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
