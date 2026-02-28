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
  test("creates and migrates metadata-only VFS tables", () => {
    const { dir, dbPath, repo } = makeRepo();
    repo.close();

    const db = new Database(dbPath, { readonly: true });
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;

    expect(tables.map((t) => t.name)).toEqual([
      "vfs_node_mount_ext",
      "vfs_nodes",
      "vfs_page_cache",
    ]);
    const mountColumns = db
      .query("PRAGMA table_info(vfs_node_mount_ext)")
      .all() as Array<{ name: string }>;
    const nodeColumns = db
      .query("PRAGMA table_info(vfs_nodes)")
      .all() as Array<{ name: string }>;
    expect(mountColumns.map((item) => item.name)).toContain("provider_extra");
    expect(mountColumns.map((item) => item.name)).toContain("auto_sync");
    expect(mountColumns.map((item) => item.name)).toContain("sync_content");
    expect(nodeColumns.map((item) => item.name)).not.toContain("title");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("upsert/get node mount ext", () => {
    const { dir, repo } = makeRepo();
    repo.upsertNodes([
      {
        nodeId: "mount-node-1",
        mountId: "m1",
        parentId: null,
        name: "m1",
        kind: "mount",
        size: null,
        mtimeMs: null,
        sourceRef: "",
        providerVersion: null,
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);
    repo.upsertNodeMountExt({
      nodeId: "mount-node-1",
      mountId: "m1",
      providerType: "google_drive",
      providerExtra: { token: "secret-token", tenant: "acme" },
      autoSync: false,
      syncMetadata: true,
      syncContent: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
      createdAtMs: 1,
      updatedAtMs: 1,
    });

    const mount = repo.getNodeMountExtByMountId("m1");
    expect(mount).not.toBeNull();
    expect(mount?.autoSync).toBe(false);
    expect(mount?.syncMetadata).toBe(true);
    expect(mount?.syncContent).toBe(true);
    expect(mount?.nodeId).toBe("mount-node-1");
    expect(mount?.providerExtra).toEqual({ token: "secret-token", tenant: "acme" });

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
        kind: "file",
        size: 2,
        mtimeMs: 2,
        sourceRef: "s2",
        providerVersion: "v2",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      {
        nodeId: "n1",
        mountId: "m1",
        parentId: "p1",
        name: "a.md",
        kind: "file",
        size: 1,
        mtimeMs: 1,
        sourceRef: "s1",
        providerVersion: "v1",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      {
        nodeId: "n3",
        mountId: "m1",
        parentId: "p1",
        name: "a.md",
        kind: "file",
        size: 3,
        mtimeMs: 3,
        sourceRef: "s3",
        providerVersion: "v3",
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

  test("delete page cache by mount id removes only matched mount keys", () => {
    const { dir, repo } = makeRepo();
    repo.upsertPageCache({
      cacheKey: "m1::p1::::10",
      itemsJson: '[{"id":"a"}]',
      nextCursor: null,
      expiresAtMs: 1000,
    });
    repo.upsertPageCache({
      cacheKey: "m2::p1::::10",
      itemsJson: '[{"id":"b"}]',
      nextCursor: null,
      expiresAtMs: 1000,
    });

    repo.deletePageCacheByMountId("m1");

    expect(repo.getPageCacheIfFresh("m1::p1::::10", 1)).toBeNull();
    expect(repo.getPageCacheIfFresh("m2::p1::::10", 1)?.itemsJson).toBe('[{"id":"b"}]');

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
