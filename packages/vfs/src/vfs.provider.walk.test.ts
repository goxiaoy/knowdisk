import { describe, expect, test } from "bun:test";
import { walk } from "./vfs.provider.walk";
import type { VfsProviderAdapter } from "./vfs.provider.types";
describe("vfs provider walk helper", () => {
  test("walkProvider traverses all nested children", async () => {
    const provider: Pick<VfsProviderAdapter, "listChildren" | "getMetadata"> = {
      async listChildren(input) {
        if (input.parentId === null) {
          return {
            items: [
              {
                sourceRef: "a.txt",
                parentSourceRef: null,
                name: "a.txt",
                kind: "file",
                size: 1,
              },
              {
                sourceRef: "sub",
                parentSourceRef: null,
                name: "sub",
                kind: "folder",
              },
            ],
          };
        }
        if (input.parentId === "sub") {
          return {
            items: [
              {
                sourceRef: "sub/b.txt",
                parentSourceRef: "sub",
                name: "b.txt",
                kind: "file",
                size: 2,
              },
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
    const provider: Pick<VfsProviderAdapter, "listChildren" | "getMetadata"> = {
      async listChildren() {
        return {
          items: [
            {
              sourceRef: "x.txt",
              parentSourceRef: null,
              name: "x.txt",
              kind: "file",
              size: 1,
            },
          ],
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
    const provider: Pick<VfsProviderAdapter, "listChildren" | "getMetadata"> = {
      async listChildren() {
        return {
          items: [
            {
              sourceRef: "a.txt",
              parentSourceRef: null,
              name: "a.txt",
              kind: "file",
              size: 2,
              mtimeMs: null,
              providerVersion: null,
            },
          ],
        };
      },
      async getMetadata() {
        return {
          sourceRef: "a.txt",
          parentSourceRef: null,
          name: "a.txt",
          kind: "file",
          size: 2,
          mtimeMs: 123,
          providerVersion: null,
        };
      },
    };

    const entries = await walk({
      provider,
      requiredFields: ["size", "mtimeMs"],
    });
    expect(entries[0]?.mtimeMs).toBe(123);
  });

  test("walkProvider enriches providerVersion when requiredFields includes providerVersion", async () => {
    const provider: Pick<VfsProviderAdapter, "listChildren" | "getMetadata"> = {
      async listChildren() {
        return {
          items: [
            {
              sourceRef: "a.txt",
              parentSourceRef: null,
              name: "a.txt",
              kind: "file",
              size: 2,
              mtimeMs: 123,
              providerVersion: null,
            },
          ],
        };
      },
      async getMetadata() {
        return {
          sourceRef: "a.txt",
          parentSourceRef: null,
          name: "a.txt",
          kind: "file",
          size: 2,
          mtimeMs: 123,
          providerVersion: "pv1",
        };
      },
    };

    const entries = await walk({
      provider,
      requiredFields: ["size", "providerVersion"],
    });
    expect(entries[0]?.providerVersion).toBe("pv1");
  });

  test("walkProvider uses provider node id when enriching providerVersion", async () => {
    const provider: Pick<VfsProviderAdapter, "listChildren" | "getMetadata"> = {
      async listChildren() {
        return {
          items: [
            {
              nodeId: "provider-file-id",
              sourceRef: "a.txt",
              parentSourceRef: null,
              name: "a.txt",
              kind: "file",
              size: 2,
              mtimeMs: 123,
              providerVersion: null,
            },
          ],
        };
      },
      async getMetadata(input) {
        if (input.id !== "provider-file-id") {
          return null;
        }
        return {
          sourceRef: "a.txt",
          parentSourceRef: null,
          name: "a.txt",
          kind: "file",
          size: 2,
          mtimeMs: 123,
          providerVersion: "pv-node-id",
        };
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
    const provider: Pick<
      VfsProviderAdapter,
      "listChildren" | "getMetadata" | "getVersion"
    > = {
      async listChildren() {
        return {
          items: [
            {
              nodeId: "provider-file-id",
              sourceRef: "a.txt",
              parentSourceRef: null,
              name: "a.txt",
              kind: "file",
              size: 2,
              mtimeMs: 123,
              providerVersion: null,
            },
          ],
        };
      },
      async getMetadata(input) {
        metadataCalls.push(input.id);
        return {
          sourceRef: "a.txt",
          parentSourceRef: null,
          name: "a.txt",
          kind: "file",
          size: 2,
          mtimeMs: 123,
          providerVersion: "pv-from-metadata",
        };
      },
      async getVersion(input) {
        versionCalls.push(input.id);
        return "pv-from-version";
      },
    };

    const entries = await walk({
      provider: provider as VfsProviderAdapter,
      requiredFields: ["providerVersion"],
    });
    expect(entries[0]?.providerVersion).toBe("pv-from-version");
    expect(metadataCalls).toEqual([]);
    expect(versionCalls).toEqual(["provider-file-id"]);
  });

  test("walkProvider traverses children by provider node id instead of sourceRef", async () => {
    const provider: Pick<VfsProviderAdapter, "listChildren" | "getMetadata"> = {
      async listChildren(input) {
        if (input.parentId === null) {
          return {
            items: [
              {
                nodeId: "folder-id",
                sourceRef: "dir",
                parentSourceRef: null,
                name: "dir",
                kind: "folder",
                size: null,
                mtimeMs: null,
                providerVersion: null,
                mountId: "m1",
                parentId: null,
                deletedAtMs: null,
                createdAtMs: 0,
                updatedAtMs: 0,
              },
            ],
          };
        }
        if (input.parentId === "folder-id") {
          return {
            items: [
              {
                nodeId: "child-id",
                sourceRef: "dir/file.txt",
                parentSourceRef: "dir",
                name: "file.txt",
                kind: "file",
                size: 1,
                mtimeMs: 1,
                providerVersion: null,
                mountId: "m1",
                parentId: "folder-id",
                deletedAtMs: null,
                createdAtMs: 0,
                updatedAtMs: 0,
              },
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
