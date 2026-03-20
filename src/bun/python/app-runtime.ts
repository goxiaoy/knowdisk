import { join } from "node:path";
import type { VfsRepository, VfsService } from "@knowdisk/vfs";
import type { Logger } from "pino";
import { createPythonWorkerIndexingHooks } from "./indexing-hooks";
import type { PythonWorkerNodeContext } from "./node-context";

export function createPythonWorkerAppRuntime(input: {
  contentRootDir: string;
  request: (method: string, params: unknown) => Promise<unknown>;
  vfs: Pick<VfsService, "registerNodeEventHooks">;
  vfsRepository: Pick<
    VfsRepository,
    "getNodeMountExtByMountId" | "listNodeMountExts" | "listNodesByMountId"
  >;
  logger: Pick<Logger, "error">;
}): {
  start(): Promise<void>;
  stop(): void;
} {
  let offHooks: (() => void) | null = input.vfs.registerNodeEventHooks(
    createPythonWorkerIndexingHooks({
      contentRootDir: input.contentRootDir,
      request: input.request,
      getMountById: (mountId) => input.vfsRepository.getNodeMountExtByMountId(mountId),
      logger: input.logger,
    })
  );

  return {
    async start() {
      try {
        await replayRecoveryIndexes(input);
      } catch (error) {
        input.logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
          },
          "failed to bootstrap python worker indexing runtime"
        );
      }
    },

    stop() {
      offHooks?.();
      offHooks = null;
    },
  };
}

async function replayRecoveryIndexes(input: {
  contentRootDir: string;
  request: (method: string, params: unknown) => Promise<unknown>;
  vfsRepository: Pick<
    VfsRepository,
    "getNodeMountExtByMountId" | "listNodeMountExts" | "listNodesByMountId"
  >;
}): Promise<void> {
  const items = buildPythonWorkerRebuildItems({
    contentRootDir: input.contentRootDir,
    vfsRepository: input.vfsRepository,
  });
  for (const item of items) {
    await input.request("index_node", item);
  }
}

function buildPythonWorkerRebuildItems(input: {
  contentRootDir: string;
  vfsRepository: Pick<
    VfsRepository,
    "getNodeMountExtByMountId" | "listNodeMountExts" | "listNodesByMountId"
  >;
}): PythonWorkerNodeContext[] {
  const items: PythonWorkerNodeContext[] = [];

  for (const mount of input.vfsRepository.listNodeMountExts()) {
    if (mount.providerType !== "local") {
      continue;
    }
    const directory = mount.providerExtra.directory;
    if (typeof directory !== "string" || directory.trim().length === 0) {
      continue;
    }

    for (const node of input.vfsRepository.listNodesByMountId(mount.mountId)) {
      if (node.kind !== "file") {
        continue;
      }
      items.push({
        node: {
          nodeId: node.nodeId,
          mountId: node.mountId,
          name: node.name,
          sourceRef: node.sourceRef,
          providerVersion: node.providerVersion,
        },
        mount: {
          mountId: mount.mountId,
          providerType: mount.providerType,
          directory,
          contentDir: join(input.contentRootDir, mount.mountId),
        },
      });
    }
  }

  return items;
}
