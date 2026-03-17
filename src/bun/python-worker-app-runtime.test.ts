import { describe, expect, mock, test } from "bun:test";
import { createPythonWorkerAppRuntime } from "./python-worker-app-runtime";

describe("createPythonWorkerAppRuntime", () => {
  test("replays local file contexts through index_node during startup", async () => {
    const request = mock(async () => ({ ok: true }));
    const offHooks = mock(() => {});

    const runtime = createPythonWorkerAppRuntime({
      contentRootDir: "/tmp/content",
      request,
      vfs: {
        registerNodeEventHooks: () => offHooks,
      } as never,
      vfsRepository: {
        getNodeMountExtByMountId: (mountId: string) =>
          mountId === "mount-local"
            ? {
                nodeId: "mount-node-1",
                mountId,
                providerType: "local",
                providerExtra: { directory: "/tmp/source" },
                autoSync: true,
                syncMetadata: true,
                syncContent: false,
                metadataTtlSec: 30,
                reconcileIntervalMs: 60_000,
                createdAtMs: 1,
                updatedAtMs: 1,
              }
            : null,
        listNodeMountExts: () => [
          {
            nodeId: "mount-node-1",
            mountId: "mount-local",
            providerType: "local",
            providerExtra: { directory: "/tmp/source" },
            autoSync: true,
            syncMetadata: true,
            syncContent: false,
            metadataTtlSec: 30,
            reconcileIntervalMs: 60_000,
            createdAtMs: 1,
            updatedAtMs: 1,
          },
          {
            nodeId: "mount-node-2",
            mountId: "mount-remote",
            providerType: "huggingface",
            providerExtra: { model: "org/repo" },
            autoSync: true,
            syncMetadata: true,
            syncContent: false,
            metadataTtlSec: 30,
            reconcileIntervalMs: 60_000,
            createdAtMs: 1,
            updatedAtMs: 1,
          },
        ],
        listNodesByMountId: (mountId: string) =>
          mountId === "mount-local"
            ? [
                {
                  nodeId: "file-1",
                  mountId,
                  parentId: "mount-node-1",
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
                {
                  nodeId: "folder-1",
                  mountId,
                  parentId: "mount-node-1",
                  name: "docs",
                  kind: "folder",
                  size: null,
                  mtimeMs: null,
                  sourceRef: "docs",
                  providerVersion: null,
                  deletedAtMs: null,
                  createdAtMs: 1,
                  updatedAtMs: 1,
                },
              ]
            : [
                {
                  nodeId: "file-2",
                  mountId,
                  parentId: "mount-node-2",
                  name: "remote.md",
                  kind: "file",
                  size: 1,
                  mtimeMs: 1,
                  sourceRef: "remote.md",
                  providerVersion: "v1",
                  deletedAtMs: null,
                  createdAtMs: 1,
                  updatedAtMs: 1,
                },
              ],
      } as never,
      logger: {
        error() {},
      } as never,
    });

    await runtime.start();

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("index_node", {
      node: {
        nodeId: "file-1",
        mountId: "mount-local",
        name: "note.md",
        sourceRef: "docs/note.md",
        providerVersion: "v1",
      },
      mount: {
        mountId: "mount-local",
        providerType: "local",
        directory: "/tmp/source",
        contentDir: "/tmp/content/mount-local",
      },
    });

    runtime.stop();
    expect(offHooks).toHaveBeenCalledTimes(1);
  });
});
