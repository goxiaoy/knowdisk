import { describe, expect, test } from "bun:test";
import { walk } from "./vfs.provider.walk";
import type { VfsProviderAdapter } from "./vfs.provider.types";
import type { VfsNode } from "./vfs.types";

function node(
  input: Partial<VfsNode> & Pick<VfsNode, "sourceRef" | "name" | "kind">,
): VfsNode {
  return {
    nodeId: input.nodeId ?? input.sourceRef,
    mountId: input.mountId ?? "m1",
    parentId: input.parentId ?? null,
    name: input.name,
    kind: input.kind,
    size: input.size ?? null,
    mtimeMs: input.mtimeMs ?? null,
    sourceRef: input.sourceRef,
    providerVersion: input.providerVersion ?? null,
    deletedAtMs: input.deletedAtMs ?? null,
    createdAtMs: input.createdAtMs ?? 0,
    updatedAtMs: input.updatedAtMs ?? 0,
  };
}

describe("vfs provider walk helper", () => {
  test("walkProvider traverses all nested children", async () => {
    const provider: VfsProviderAdapter = {
      type: "test",
      capabilities: { watch: false },
      async listChildren(input) {
        if (input.parentId === null) {
          return {
            items: [
              node({ sourceRef: "a.txt", name: "a.txt", kind: "file", size: 1 }),
              node({ sourceRef: "sub", name: "sub", kind: "folder" }),
            ],
          };
        }
        if (input.parentId === "sub") {
          return {
            items: [
              node({
                sourceRef: "sub/b.txt",
                parentId: "sub",
                name: "b.txt",
                kind: "file",
                size: 2,
              }),
            ],
          };
        }
        return { items: [] };
      },
      async getMetadata() {
        return null;
      },
    };

    const entries = await walk({ provider });
    expect(entries.map((entry) => entry.path).sort()).toEqual(["a.txt", "sub", "sub/b.txt"]);
  });

  test("walkProvider supports callback style", async () => {
    const provider: VfsProviderAdapter = {
      type: "test",
      capabilities: { watch: false },
      async listChildren() {
        return {
          items: [node({ sourceRef: "x.txt", name: "x.txt", kind: "file", size: 1 })],
        };
      },
      async getMetadata() {
        return null;
      },
    };

    const callbackResult = await new Promise<string[]>((resolve, reject) => {
      walk({ provider }, (error, entries) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(entries.map((entry) => entry.path));
      });
    });
    expect(callbackResult).toEqual(["x.txt"]);
  });

  test("walkProvider enriches required fields via getMetadata", async () => {
    const provider: VfsProviderAdapter = {
      type: "test",
      capabilities: { watch: false },
      async listChildren() {
        return {
          items: [
            node({
              sourceRef: "a.txt",
              name: "a.txt",
              kind: "file",
              size: 2,
              mtimeMs: null,
              providerVersion: null,
            }),
          ],
        };
      },
      async getMetadata() {
        return node({
          sourceRef: "a.txt",
          name: "a.txt",
          kind: "file",
          size: 2,
          mtimeMs: 123,
          providerVersion: null,
        });
      },
    };

    const entries = await walk({
      provider,
      requiredFields: ["size", "mtimeMs"],
    });
    expect(entries[0]?.mtimeMs).toBe(123);
  });

  test("walkProvider enriches providerVersion when requiredFields includes providerVersion", async () => {
    const provider: VfsProviderAdapter = {
      type: "test",
      capabilities: { watch: false },
      async listChildren() {
        return {
          items: [
            node({
              sourceRef: "a.txt",
              name: "a.txt",
              kind: "file",
              size: 2,
              mtimeMs: 123,
              providerVersion: null,
            }),
          ],
        };
      },
      async getMetadata() {
        return node({
          sourceRef: "a.txt",
          name: "a.txt",
          kind: "file",
          size: 2,
          mtimeMs: 123,
          providerVersion: "pv1",
        });
      },
    };

    const entries = await walk({
      provider,
      requiredFields: ["size", "providerVersion"],
    });
    expect(entries[0]?.providerVersion).toBe("pv1");
  });

  test("walkProvider uses provider node id when enriching providerVersion", async () => {
    const provider: VfsProviderAdapter = {
      type: "test",
      capabilities: { watch: false },
      async listChildren() {
        return {
          items: [
            node({
              nodeId: "provider-file-id",
              sourceRef: "a.txt",
              name: "a.txt",
              kind: "file",
              size: 2,
              mtimeMs: 123,
              providerVersion: null,
            }),
          ],
        };
      },
      async getMetadata(input) {
        if (input.id !== "provider-file-id") {
          return null;
        }
        return node({
          sourceRef: "a.txt",
          name: "a.txt",
          kind: "file",
          size: 2,
          mtimeMs: 123,
          providerVersion: "pv-node-id",
        });
      },
    };

    const entries = await walk({
      provider,
      requiredFields: ["providerVersion"],
    });
    expect(entries[0]?.providerVersion).toBe("pv-node-id");
  });

  test("walkProvider prefers getVersion for providerVersion-only enrichment", async () => {
    const metadataCalls: string[] = [];
    const versionCalls: string[] = [];
    const provider: VfsProviderAdapter = {
      type: "test",
      capabilities: { watch: false },
      async listChildren() {
        return {
          items: [
            node({
              nodeId: "provider-file-id",
              sourceRef: "a.txt",
              name: "a.txt",
              kind: "file",
              size: 2,
              mtimeMs: 123,
              providerVersion: null,
            }),
          ],
        };
      },
      async getMetadata(input) {
        metadataCalls.push(input.id);
        return node({
          sourceRef: "a.txt",
          name: "a.txt",
          kind: "file",
          size: 2,
          mtimeMs: 123,
          providerVersion: "pv-from-metadata",
        });
      },
      async getVersion(input) {
        versionCalls.push(input.id);
        return "pv-from-version";
      },
    };

    const entries = await walk({
      provider,
      requiredFields: ["providerVersion"],
    });
    expect(entries[0]?.providerVersion).toBe("pv-from-version");
    expect(metadataCalls).toEqual([]);
    expect(versionCalls).toEqual(["provider-file-id"]);
  });

  test("walkProvider traverses children by provider node id instead of sourceRef", async () => {
    const provider: VfsProviderAdapter = {
      type: "test",
      capabilities: { watch: false },
      async listChildren(input) {
        if (input.parentId === null) {
          return {
            items: [
              node({
                nodeId: "folder-id",
                sourceRef: "dir",
                name: "dir",
                kind: "folder",
              }),
            ],
          };
        }
        if (input.parentId === "folder-id") {
          return {
            items: [
              node({
                nodeId: "child-id",
                sourceRef: "dir/file.txt",
                parentId: "folder-id",
                name: "file.txt",
                kind: "file",
                size: 1,
                mtimeMs: 1,
              }),
            ],
          };
        }
        return { items: [] };
      },
      async getMetadata() {
        return null;
      },
    };

    const entries = await walk({ provider });
    expect(entries.map((entry) => entry.sourceRef)).toEqual(["dir", "dir/file.txt"]);
  });
});
