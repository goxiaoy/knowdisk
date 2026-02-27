import { describe, expect, it } from "bun:test";
import { VFS_TYPES_READY } from "./vfs.types";
import type { VfsCursor, VfsNode } from "./vfs.types";

describe("vfs types", () => {
  it("exports runtime sentinel", () => {
    expect(VFS_TYPES_READY).toBe(true);
  });

  it("supports dual-version node model", () => {
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
      contentHash: "sha256:xxx",
      contentState: "cached",
      deletedAtMs: null,
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    expect(node.providerVersion).toBe("rev-1");
    expect(node.contentHash).toContain("sha256");
  });

  it("supports cursor mode encoding boundary", () => {
    const cursor: VfsCursor = { mode: "local", token: "abc" };
    expect(cursor.mode).toBe("local");
  });
});
