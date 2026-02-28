import { describe, expect, test } from "bun:test";
import { createVfsNodeId, createVfsParentId, decodeBase64UrlNodeIdToUuid } from "./vfs.node-id";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("vfs node id", () => {
  test("creates deterministic node id from mountId/sourceRef", () => {
    const id1 = createVfsNodeId({ mountId: "m1", sourceRef: "a/b.txt" });
    const id2 = createVfsNodeId({ mountId: "m1", sourceRef: "a/b.txt" });
    expect(id1).toBe(id2);
    expect(id1.includes(":")).toBe(false);
  });

  test("creates different node id for different sourceRef", () => {
    const id1 = createVfsNodeId({ mountId: "m1", sourceRef: "a.txt" });
    const id2 = createVfsNodeId({ mountId: "m1", sourceRef: "b.txt" });
    expect(id1).not.toBe(id2);
  });

  test("encoded node id decodes to a uuid string", () => {
    const nodeId = createVfsNodeId({ mountId: "m1", sourceRef: "a.txt" });
    const uuid = decodeBase64UrlNodeIdToUuid(nodeId);
    expect(UUID_REGEX.test(uuid)).toBe(true);
  });

  test("parent id is null for root and encoded id for non-root", () => {
    expect(createVfsParentId({ mountId: "m1", parentSourceRef: null })).toBeNull();
    const parentId = createVfsParentId({ mountId: "m1", parentSourceRef: "dir" });
    expect(parentId).not.toBeNull();
    expect(UUID_REGEX.test(decodeBase64UrlNodeIdToUuid(parentId!))).toBe(true);
  });
});
