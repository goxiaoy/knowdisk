import { describe, expect, mock, test } from "bun:test";
import { createPythonWorkerAppRuntime } from "./app-runtime";

describe("createPythonWorkerAppRuntime", () => {
  test("does not replay local file contexts through index_node during startup", async () => {
    const request = mock(async () => ({ ok: true }));
    const offHooks = mock(() => {});

    const runtime = createPythonWorkerAppRuntime({
      contentRootDir: "/tmp/content",
      request,
      vfs: {
        registerNodeEventHooks: () => offHooks,
      } as never,
      vfsRepository: {
        listNodesByMountId: () => [],
      } as never,
      vfsMountRepository: {
        getNodeMountExtByMountId: (mountId: string) =>
          mountId === "mount-local"
            ? {
                nodeId: "mount-node-1",
                mountId,
                providerType: "local",
                providerExtra: { directory: "/tmp/source" },
                autoSync: true,
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
            syncContent: false,
            metadataTtlSec: 30,
            reconcileIntervalMs: 60_000,
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

    expect(request).not.toHaveBeenCalled();

    runtime.stop();
    expect(offHooks).toHaveBeenCalledTimes(1);
  });
});
