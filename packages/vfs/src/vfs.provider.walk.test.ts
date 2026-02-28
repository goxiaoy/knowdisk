import { describe, expect, test } from "bun:test";
import { walk, walkProvider } from "./vfs.provider.walk";
import type { VfsProviderAdapter } from "./vfs.provider.types";
import type { VfsMount } from "./vfs.types";

function makeMount(): VfsMount {
  return {
    mountId: "walk-m1",
    providerType: "mock",
    providerExtra: {},
    syncMetadata: true,
    metadataTtlSec: 60,
    reconcileIntervalMs: 1000,
  };
}

describe("vfs provider walk helper", () => {
  test("walkProvider traverses all nested children", async () => {
    const mount = makeMount();
    const provider: Pick<VfsProviderAdapter, "listChildren"> = {
      async listChildren(input) {
        if (input.parentId === null) {
          return {
            items: [
              {
                id: "a.txt",
                parentId: null,
                name: "a.txt",
                kind: "file",
                size: 1,
              },
              {
                id: "sub",
                parentId: null,
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
                id: "sub/b.txt",
                parentId: "sub",
                name: "b.txt",
                kind: "file",
                size: 2,
              },
            ],
          };
        }
        return { items: [] };
      },
    };

    const entries = await walkProvider({ provider, mount });
    expect(entries.map((entry) => entry.path).sort()).toEqual(["a.txt", "sub", "sub/b.txt"]);
  });

  test("walkProvider supports callback style", async () => {
    const mount = makeMount();
    const provider: Pick<VfsProviderAdapter, "listChildren"> = {
      async listChildren() {
        return {
          items: [
            {
              id: "x.txt",
              parentId: null,
              name: "x.txt",
              kind: "file",
              size: 1,
            },
          ],
        };
      },
    };

    const callbackResult = await new Promise<string[]>((resolve, reject) => {
      walk({ provider, mount }, (error, entries) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(entries.map((entry) => entry.path));
      });
    });
    expect(callbackResult).toEqual(["x.txt"]);
  });
});
