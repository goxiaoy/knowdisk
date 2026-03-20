import { describe, expect, test } from "bun:test";
import { buildPythonWorkerNodeContext } from "./node-context";

describe("buildPythonWorkerNodeContext", () => {
  test("builds local provider context for a file node", async () => {
    const result = await buildPythonWorkerNodeContext({
      nodeId: "node-1",
      contentRootDir: "/app/vfs/content",
      getNodeById: async (nodeId) =>
        nodeId === "node-1"
          ? {
              nodeId: "node-1",
              mountId: "mount-1",
              parentId: "parent-1",
              name: "note.md",
              kind: "file",
              size: 12,
              mtimeMs: 123,
              sourceRef: "docs/note.md",
              providerVersion: "v1",
              deletedAtMs: null,
              createdAtMs: 1,
              updatedAtMs: 2,
            }
          : null,
      getMountById: async (mountId) =>
        mountId === "mount-1"
          ? {
              mountId: "mount-1",
              providerType: "local",
              providerExtra: {
                directory: "/tmp/source",
              },
              autoSync: true,
              syncMetadata: true,
              syncContent: false,
              metadataTtlSec: 30,
              reconcileIntervalMs: 1000,
              nodeId: "mount-node",
              createdAtMs: 1,
              updatedAtMs: 2,
            }
          : null,
    });

    expect(result).toEqual({
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
        syncedContentPath: "/app/vfs/content/mount-1/docs/note.md",
        localFilePath: "/tmp/source/docs/note.md",
      },
    });
  });

  test("returns structured error for missing nodes", async () => {
    await expect(
      buildPythonWorkerNodeContext({
        nodeId: "missing",
        contentRootDir: "/app/vfs/content",
        getNodeById: async () => null,
        getMountById: async () => null,
      })
    ).rejects.toThrow("node not found: missing");
  });

  test("rejects non-local providers", async () => {
    await expect(
      buildPythonWorkerNodeContext({
        nodeId: "node-1",
        contentRootDir: "/app/vfs/content",
        getNodeById: async () => ({
          nodeId: "node-1",
          mountId: "mount-1",
          parentId: "parent-1",
          name: "remote.md",
          kind: "file",
          size: 12,
          mtimeMs: 123,
          sourceRef: "remote.md",
          providerVersion: "v1",
          deletedAtMs: null,
          createdAtMs: 1,
          updatedAtMs: 2,
        }),
        getMountById: async () => ({
          mountId: "mount-1",
          providerType: "huggingface",
          providerExtra: { model: "org/repo" },
          autoSync: true,
          syncMetadata: true,
          syncContent: false,
          metadataTtlSec: 30,
          reconcileIntervalMs: 1000,
          nodeId: "mount-node",
          createdAtMs: 1,
          updatedAtMs: 2,
        }),
      })
    ).rejects.toThrow("python worker only supports local provider mounts");
  });
});
