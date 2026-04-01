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

function listQueuedEvents(repo: ReturnType<typeof createVfsRepository>, mountId: string) {
  return repo.listNodeEvents().filter((event) => event.mountId === mountId);
}

describe("vfs repository", () => {
  test("creates and migrates metadata-only VFS tables", () => {
    const { dir, dbPath, repo } = makeRepo();
    repo.close();

    const db = new Database(dbPath, { readonly: true });
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;

    expect(tables.map((t) => t.name)).toContain("vfs_node_events");
    expect(tables.map((t) => t.name)).toContain("vfs_node_mount_ext");
    expect(tables.map((t) => t.name)).toContain("vfs_nodes");
    const mountColumns = db.query("PRAGMA table_info(vfs_node_mount_ext)").all() as Array<{
      name: string;
    }>;
    const nodeColumns = db.query("PRAGMA table_info(vfs_nodes)").all() as Array<{ name: string }>;
    const eventColumns = db.query("PRAGMA table_info(vfs_node_events)").all() as Array<{
      name: string;
    }>;
    expect(mountColumns.map((item) => item.name)).toContain("provider_extra");
    expect(mountColumns.map((item) => item.name)).toContain("auto_sync");
    expect(mountColumns.map((item) => item.name)).toContain("sync_content");
    expect(nodeColumns.map((item) => item.name)).not.toContain("title");
    expect(eventColumns.map((item) => item.name)).toContain("source_ref");
    expect(eventColumns.map((item) => item.name)).not.toContain("node_id");

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
      syncContent: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
      createdAtMs: 1,
      updatedAtMs: 1,
    });

    const mount = repo.getNodeMountExtByMountId("m1");
    expect(mount).not.toBeNull();
    expect(mount?.autoSync).toBe(false);
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

  test("listNodesByMountIdAndSourceRef returns matched node", () => {
    const { dir, repo } = makeRepo();
    repo.upsertNodes([
      {
        nodeId: "n1",
        mountId: "m1",
        parentId: null,
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
        nodeId: "n2",
        mountId: "m2",
        parentId: null,
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
    ]);

    expect(repo.listNodesByMountIdAndSourceRef("m1", "s1")?.nodeId).toBe("n1");
    expect(repo.listNodesByMountIdAndSourceRef("m1", "missing")).toBeNull();

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });


  test("insert/list/delete node events refreshes id on conflict and deletes by event rows", () => {
    const { dir, repo } = makeRepo();
    expect("listNodeEvents" in repo).toBe(true);
    expect("subscribeNodeChanges" in repo).toBe(true);
    expect("subscribeNodeEventsChanged" in repo).toBe(true);
    repo.insertNodeEvents([
      {
        sourceRef: "s1",
        mountId: "m1",
        parentId: "p1",
        type: "add",
        node: {
          nodeId: "n1",
          mountId: "m1",
          parentId: "p1",
          name: "a.txt",
          kind: "file",
          size: 1,
          mtimeMs: 1,
          sourceRef: "s1",
          providerVersion: "v1",
          deletedAtMs: null,
          createdAtMs: 1,
          updatedAtMs: 1,
        },
        createdAtMs: 1,
      },
    ]);
    const addIdBefore = listQueuedEvents(repo, "m1")[0]?.id;
    expect(addIdBefore).toEqual(expect.any(String));
    repo.insertNodeEvents([
      {
        sourceRef: "s1",
        mountId: "m1",
        parentId: "p2",
        type: "update_metadata",
        node: null,
        createdAtMs: 2,
      },
    ]);
    repo.insertNodeEvents([
      {
        sourceRef: "s1",
        mountId: "m1",
        parentId: "p3",
        type: "update_content",
        node: null,
        createdAtMs: 3,
      },
    ]);
    repo.insertNodeEvents([
      {
        sourceRef: "s1",
        mountId: "m1",
        parentId: "p1-new",
        type: "add",
        node: {
          nodeId: "n1-next",
          mountId: "m1",
          parentId: "p1-new",
          name: "a-next.txt",
          kind: "file",
          size: 9,
          mtimeMs: 10,
          sourceRef: "s1",
          providerVersion: "v2",
          deletedAtMs: null,
          createdAtMs: 10,
          updatedAtMs: 10,
        },
        createdAtMs: 10,
      },
    ]);
    const events = listQueuedEvents(repo, "m1");
    expect(events).toHaveLength(3);
    expect(events.every((item) => typeof item.id === "string" && item.id.length > 0)).toBe(true);
    expect(events.map((item) => item.sourceRef)).toEqual(["s1", "s1", "s1"]);
    expect(events.map((item) => item.type)).toEqual(["update_metadata", "update_content", "add"]);
    expect(events[2]?.id).not.toBe(addIdBefore);
    expect(events[2]).toEqual({
      id: events[2]!.id,
      sourceRef: "s1",
      mountId: "m1",
      parentId: "p1-new",
      type: "add",
      node: {
        nodeId: "n1-next",
        mountId: "m1",
        parentId: "p1-new",
        name: "a-next.txt",
        kind: "file",
        size: 9,
        mtimeMs: 10,
        sourceRef: "s1",
        providerVersion: "v2",
        deletedAtMs: null,
        createdAtMs: 10,
        updatedAtMs: 10,
      },
      createdAtMs: 10,
    });

    repo.insertNodeEvents([
      {
        sourceRef: "s1",
        mountId: "m1",
        parentId: "p2",
        type: "delete",
        node: null,
        createdAtMs: 4,
      },
    ]);
    const withDelete = listQueuedEvents(repo, "m1");
    expect(withDelete).toHaveLength(4);
    expect(new Set(withDelete.map((item) => item.id)).size).toBe(4);
    expect(withDelete.map((item) => item.type)).toEqual([
      "update_metadata",
      "update_content",
      "delete",
      "add",
    ]);

    repo.deleteNodeEvents([
      { id: withDelete[0]!.id, mountId: withDelete[0]!.mountId },
      { id: withDelete[2]!.id, mountId: withDelete[2]!.mountId },
    ]);
    const remained = listQueuedEvents(repo, "m1");
    expect(remained).toEqual([
      {
        id: withDelete[1]!.id,
        sourceRef: "s1",
        mountId: "m1",
        parentId: "p3",
        type: "update_content",
        node: null,
        createdAtMs: 3,
      },
      {
        id: withDelete[3]!.id,
        sourceRef: "s1",
        mountId: "m1",
        parentId: "p1-new",
        type: "add",
        node: {
          nodeId: "n1-next",
          mountId: "m1",
          parentId: "p1-new",
          name: "a-next.txt",
          kind: "file",
          size: 9,
          mtimeMs: 10,
          sourceRef: "s1",
          providerVersion: "v2",
          deletedAtMs: null,
          createdAtMs: 10,
          updatedAtMs: 10,
        },
        createdAtMs: 10,
      },
    ]);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("subscribeNodeEventsChanged reports affected mount ids on insert and delete", () => {
    const { dir, repo } = makeRepo();
    const mountIds: string[] = [];
    const unsubscribe = repo.subscribeNodeEventsChanged((mountId) => {
      mountIds.push(mountId);
    });

    repo.insertNodeEvents([
      {
        sourceRef: "s1",
        mountId: "m1",
        parentId: "p1",
        type: "add",
        node: null,
        createdAtMs: 1,
      },
    ]);
    const inserted = listQueuedEvents(repo, "m1");
    repo.deleteNodeEvents([{ id: inserted[0]!.id, mountId: inserted[0]!.mountId }]);

    expect(mountIds).toEqual(["m1", "m1"]);

    unsubscribe();
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("listNodeEvents filters by type", () => {
    const { dir, repo } = makeRepo();

    repo.insertNodeEvents([
      {
        sourceRef: "a",
        mountId: "m1",
        parentId: null,
        type: "add",
        node: null,
        createdAtMs: 1,
      },
      {
        sourceRef: "a",
        mountId: "m1",
        parentId: null,
        type: "update_content",
        node: null,
        createdAtMs: 2,
      },
      {
        sourceRef: "b",
        mountId: "m2",
        parentId: null,
        type: "delete",
        node: null,
        createdAtMs: 3,
      },
    ]);

    expect(repo.listNodeEvents({ types: ["update_content"] }).map((event) => event.type)).toEqual([
      "update_content",
    ]);
    expect(repo.listNodeEvents({ types: ["add", "delete"] }).map((event) => event.type)).toEqual([
      "add",
      "delete",
    ]);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("subscribeNodeChanges receives upserted row", () => {
    const { dir, repo } = makeRepo();
    const rows = [];
    const unsubscribe = repo.subscribeNodeChanges((row) => {
      rows.push(row);
    });

    repo.upsertNodes([
      {
        nodeId: "n1",
        mountId: "m1",
        parentId: "p1",
        name: "a.txt",
        kind: "file",
        size: 1,
        mtimeMs: 1,
        sourceRef: "s1",
        providerVersion: "v1",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);

    expect(rows).toEqual([
      {
        nodeId: "n1",
        mountId: "m1",
        parentId: "p1",
        name: "a.txt",
        kind: "file",
        size: 1,
        mtimeMs: 1,
        sourceRef: "s1",
        providerVersion: "v1",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);

    unsubscribe();
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("computes queue progress by mount in db layer using distinct source refs", () => {
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
      {
        nodeId: "n1",
        mountId: "m1",
        parentId: "mount-node-1",
        name: "a.md",
        kind: "file",
        size: 1,
        mtimeMs: 1,
        sourceRef: "a.md",
        providerVersion: "v1",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      {
        nodeId: "n2",
        mountId: "m1",
        parentId: "mount-node-1",
        name: "b",
        kind: "folder",
        size: null,
        mtimeMs: 1,
        sourceRef: "b",
        providerVersion: "v1",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      {
        nodeId: "n3",
        mountId: "m1",
        parentId: "mount-node-1",
        name: "deleted.md",
        kind: "file",
        size: 1,
        mtimeMs: 1,
        sourceRef: "deleted.md",
        providerVersion: "v1",
        deletedAtMs: 2,
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    ]);
    repo.insertNodeEvents([
      {
        sourceRef: "a.md",
        mountId: "m1",
        parentId: "mount-node-1",
        type: "update_content",
        node: null,
        createdAtMs: 3,
      },
      {
        sourceRef: "b",
        mountId: "m1",
        parentId: "mount-node-1",
        type: "update_metadata",
        node: null,
        createdAtMs: 4,
      },
      {
        sourceRef: "a.md",
        mountId: "m1",
        parentId: "mount-node-1",
        type: "delete",
        node: null,
        createdAtMs: 5,
      },
      {
        sourceRef: "new.md",
        mountId: "m1",
        parentId: "mount-node-1",
        type: "add",
        node: null,
        createdAtMs: 6,
      },
    ]);

    expect(repo.getQueueProgressByMountId("m1")).toEqual({
      pendingUnits: 3,
    });

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
