import { expect, test } from "bun:test";
import type { VfsNode } from "@knowdisk/vfs";
import {
  applyMountNodeChange,
  applyVfsSyncerEvent,
  refreshVfsMountPendingUnits,
} from "./vfs-status";

test("queue progress updates pending-only semantics", () => {
  const status = applyVfsSyncerEvent(
    {
      mountNodeId: "m1",
      mountId: "m1",
      name: "Docs",
      phase: "metadata",
      pendingUnits: 0,
      error: "",
    },
    {
      type: "queue_progress",
      payload: {
        pendingUnits: 5,
      },
    }
  );

  expect(status.pendingUnits).toBe(5);
});

test("metadata progress updates phase but preserves queue-based percentage", () => {
  const status = applyVfsSyncerEvent(
    {
      mountNodeId: "m1",
      mountId: "m1",
      name: "Docs",
      phase: "idle",
      pendingUnits: 5,
      error: "",
    },
    {
      type: "metadata_progress",
      payload: {
        total: 10,
        processed: 3,
        added: 1,
        updated: 1,
        deleted: 0,
      },
    }
  );

  expect(status.phase).toBe("metadata");
});

test("idle status clears remaining queue and completes progress", () => {
  const status = applyVfsSyncerEvent(
    {
      mountNodeId: "m1",
      mountId: "m1",
      name: "Docs",
      phase: "content",
      pendingUnits: 8,
      error: "",
    },
    {
      type: "status",
      payload: {
        isSyncing: false,
        phase: "idle",
      },
    }
  );

  expect(status.phase).toBe("idle");
  expect(status.pendingUnits).toBe(0);
});

test("refreshVfsMountPendingUnits recalculates pending counts on demand", async () => {
  const mounts = await refreshVfsMountPendingUnits(
    [
      {
        mountNodeId: "m1",
        mountId: "m1",
        name: "Docs",
        phase: "idle",
        pendingUnits: 0,
        error: "",
      },
      {
        mountNodeId: "m2",
        mountId: "m2",
        name: "Media",
        phase: "metadata",
        pendingUnits: 0,
        error: "",
      },
    ],
    async (mountId) => ({ pendingUnits: mountId === "m1" ? 0 : 3 })
  );

  expect(mounts).toEqual([
    {
      mountNodeId: "m1",
      mountId: "m1",
      name: "Docs",
      phase: "idle",
      pendingUnits: 0,
      error: "",
    },
    {
      mountNodeId: "m2",
      mountId: "m2",
      name: "Media",
      phase: "metadata",
      pendingUnits: 3,
      error: "",
    },
  ]);
});

test("applyMountNodeChange updates mount name on rename", () => {
  const mounts = applyMountNodeChange(
    [
      {
        mountNodeId: "m1",
        mountId: "m1",
        name: "Old Name",
        phase: "idle",
        pendingUnits: 0,
        error: "",
      },
    ],
    {
      nodeId: "mount-node-1",
      mountId: "m1",
      mountNodeId: "m1",
      parentId: null,
      name: "New Name",
      kind: "mount",
      type: "mount",
      origin: "managed",
      size: null,
      mtimeMs: null,
      sourceRef: "",
      providerVersion: null,
      deletedAtMs: null,
      createdAtMs: 1,
      updatedAtMs: 2,
    } satisfies VfsNode
  );

  expect(mounts).toEqual([
    {
      mountNodeId: "m1",
      mountId: "m1",
      name: "New Name",
      phase: "idle",
      pendingUnits: 0,
      error: "",
    },
  ]);
});

test("applyMountNodeChange removes mount when mount node is deleted", () => {
  const mounts = applyMountNodeChange(
    [
      {
        mountNodeId: "m1",
        mountId: "m1",
        name: "Docs",
        phase: "idle",
        pendingUnits: 0,
        error: "",
      },
      {
        mountNodeId: "m2",
        mountId: "m2",
        name: "Media",
        phase: "metadata",
        pendingUnits: 2,
        error: "",
      },
    ],
    {
      nodeId: "mount-node-1",
      mountId: "m1",
      mountNodeId: "m1",
      parentId: null,
      name: "Docs",
      kind: "mount",
      type: "mount",
      origin: "managed",
      size: null,
      mtimeMs: null,
      sourceRef: "",
      providerVersion: null,
      deletedAtMs: 10,
      createdAtMs: 1,
      updatedAtMs: 10,
    } satisfies VfsNode
  );

  expect(mounts).toEqual([
    {
      mountNodeId: "m2",
      mountId: "m2",
      name: "Media",
      phase: "metadata",
      pendingUnits: 2,
      error: "",
    },
  ]);
});
