import { describe, expect, mock, test } from "bun:test";
import { createPythonWorkerIndexingHooks } from "./indexing-hooks";

describe("createPythonWorkerIndexingHooks", () => {
  test("afterUpdateContent sends index_node with local node context", async () => {
    const request = mock(async () => ({ indexed: 1 }));
    const getMountById = mock(async () => ({
      mountId: "mount-1",
      providerType: "local",
      providerExtra: {
        directory: "/tmp/source",
      },
    }));
    const hooks = createPythonWorkerIndexingHooks({
      contentRootDir: "/app/vfs/content",
      request,
      getMountById,
      logger: { error() {} },
    });

    await hooks.afterUpdateContent?.({
      mount: null,
      event: {} as never,
      prevNode: null,
      nextNode: {
        nodeId: "node-1",
        mountId: "mount-1",
        parentId: null,
        name: "note.md",
        kind: "file",
        size: 1,
        mtimeMs: 1,
        sourceRef: "docs/note.md",
        providerVersion: "v1",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    });

    expect(request).toHaveBeenCalledWith("index_node", {
      node: {
        nodeId: "node-1",
        mountId: "mount-1",
        name: "note.md",
        sourceRef: "docs/note.md",
        providerVersion: "v1",
      },
      mount: {
        mountId: "mount-1",
        providerType: "local",
        directory: "/tmp/source",
        contentDir: "/app/vfs/content/mount-1",
      },
    });
  });

  test("afterDelete sends delete_node for file nodes", async () => {
    const request = mock(async () => ({ ok: true }));
    const hooks = createPythonWorkerIndexingHooks({
      contentRootDir: "/app/vfs/content",
      request,
      getMountById: async () => null,
      logger: { error() {} },
    });

    await hooks.afterDelete?.({
      mount: null,
      event: {} as never,
      prevNode: {
        nodeId: "node-1",
        mountId: "mount-1",
        parentId: null,
        name: "note.md",
        kind: "file",
        size: 1,
        mtimeMs: 1,
        sourceRef: "docs/note.md",
        providerVersion: "v1",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      nextNode: null,
    });

    expect(request).toHaveBeenCalledWith("delete_node", { nodeId: "node-1" });
  });
});
