import { describe, expect, test } from "bun:test";
import type { VfsNode } from "@knowdisk/vfs";
import { buildRecentFileSearchResults } from "./search";

function createNode(input: Partial<VfsNode> & Pick<VfsNode, "nodeId" | "mountId" | "name" | "kind">): VfsNode {
  return {
    nodeId: input.nodeId,
    mountId: input.mountId,
    parentId: input.parentId ?? null,
    name: input.name,
    kind: input.kind,
    size: input.size ?? 1,
    mtimeMs: input.mtimeMs ?? null,
    sourceRef: input.sourceRef ?? input.name,
    providerVersion: input.providerVersion ?? "v1",
    deletedAtMs: input.deletedAtMs ?? null,
    createdAtMs: input.createdAtMs ?? 1,
    updatedAtMs: input.updatedAtMs ?? 1,
  };
}

describe("buildRecentFileSearchResults", () => {
  test("sorts files by mtime descending and excludes non-files", () => {
    const results = buildRecentFileSearchResults({
      nodesByMount: [[
        createNode({
          nodeId: "folder-1",
          mountId: "m1",
          name: "docs",
          kind: "folder",
          updatedAtMs: 500,
        }),
        createNode({
          nodeId: "file-1",
          mountId: "m1",
          name: "alpha.md",
          kind: "file",
          sourceRef: "docs/alpha.md",
          mtimeMs: 100,
          updatedAtMs: 200,
        }),
        createNode({
          nodeId: "file-2",
          mountId: "m1",
          name: "beta.md",
          kind: "file",
          sourceRef: "docs/beta.md",
          mtimeMs: 300,
          updatedAtMs: 400,
        }),
      ]],
    });

    expect(results.map((item) => item.nodeId)).toEqual(["file-2", "file-1"]);
    expect(results[0]).toMatchObject({
      title: "beta.md",
      text: "docs/beta.md",
    });
  });

  test("falls back to updatedAtMs when mtimeMs is null", () => {
    const results = buildRecentFileSearchResults({
      nodesByMount: [[
        createNode({
          nodeId: "file-old",
          mountId: "m1",
          name: "old.md",
          kind: "file",
          mtimeMs: 100,
          updatedAtMs: 100,
        }),
        createNode({
          nodeId: "file-recent",
          mountId: "m1",
          name: "recent.md",
          kind: "file",
          mtimeMs: null,
          updatedAtMs: 500,
        }),
      ]],
    });

    expect(results.map((item) => item.nodeId)).toEqual(["file-recent", "file-old"]);
  });

  test("excludes deleted files and respects the result limit", () => {
    const results = buildRecentFileSearchResults({
      nodesByMount: [[
        createNode({
          nodeId: "file-deleted",
          mountId: "m1",
          name: "deleted.md",
          kind: "file",
          updatedAtMs: 1000,
          deletedAtMs: 1,
        }),
        createNode({
          nodeId: "file-1",
          mountId: "m1",
          name: "one.md",
          kind: "file",
          updatedAtMs: 100,
        }),
        createNode({
          nodeId: "file-2",
          mountId: "m1",
          name: "two.md",
          kind: "file",
          updatedAtMs: 200,
        }),
      ]],
      limit: 1,
    });

    expect(results.map((item) => item.nodeId)).toEqual(["file-2"]);
  });
});
