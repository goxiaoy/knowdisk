import { describe, expect, it } from "bun:test";
import { VFS_TYPES_READY } from "./vfs.types";
import type { VfsCursor, VfsMountConfig, VfsNode } from "./vfs.types";

describe("vfs types", () => {
  it("exports runtime sentinel", () => {
    expect(VFS_TYPES_READY).toBe(true);
  });

  it("supports metadata-only mount/node model", () => {
    const mount: VfsMountConfig = {
      mountPath: "/abc/drive",
      providerType: "drive",
      providerExtra: { token: "x" },
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1_000,
    };
    const node: VfsNode = {
      nodeId: "n1",
      mountId: "m1",
      parentId: null,
      name: "doc.md",
      vpath: "/abc/drive/doc.md",
      kind: "file",
      title: "doc",
      size: 10,
      mtimeMs: 1,
      sourceRef: "provider-id",
      providerVersion: "rev-1",
      deletedAtMs: null,
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    expect(mount.syncMetadata).toBe(true);
    expect(node.providerVersion).toBe("rev-1");
  });

  it("supports cursor mode encoding boundary", () => {
    const cursor: VfsCursor = { mode: "local", token: "abc" };
    expect(cursor.mode).toBe("local");
  });
});
