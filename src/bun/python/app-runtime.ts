import type { VfsMountRepository, VfsRepository, VfsService } from "@knowdisk/vfs";
import type { Logger } from "pino";
import { createPythonWorkerIndexingHooks } from "./indexing-hooks";

export function createPythonWorkerAppRuntime(input: {
  contentRootDir: string;
  request: (method: string, params: unknown) => Promise<unknown>;
  vfs: Pick<VfsService, "registerNodeEventHooks">;
  vfsRepository: Pick<VfsRepository, "listNodesByMountId">;
  vfsMountRepository: Pick<VfsMountRepository, "getNodeMountExtByMountId" | "listNodeMountExts">;
  logger: Pick<Logger, "error">;
}): {
  start(): Promise<void>;
  stop(): void;
} {
  let offHooks: (() => void) | null = input.vfs.registerNodeEventHooks(
    createPythonWorkerIndexingHooks({
      contentRootDir: input.contentRootDir,
      request: input.request,
      getMountById: (mountId) => input.vfsMountRepository.getNodeMountExtByMountId(mountId),
      logger: input.logger,
    })
  );

  return {
    async start() {},

    stop() {
      offHooks?.();
      offHooks = null;
    },
  };
}
