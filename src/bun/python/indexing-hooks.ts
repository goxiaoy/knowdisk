import type { VfsNodeEventHooks } from "@knowdisk/vfs";
import type { Logger } from "pino";
import { buildPythonWorkerNodeContext } from "./node-context";

type LocalMountLike = {
  mountId: string;
  providerType: string;
  providerExtra: Record<string, unknown>;
};

export function createPythonWorkerIndexingHooks(input: {
  contentRootDir: string;
  request: (method: string, params: unknown) => Promise<unknown>;
  getMountById: (mountId: string) => Promise<LocalMountLike | null> | LocalMountLike | null;
  logger: Pick<Logger, "error">;
}): VfsNodeEventHooks {
  return {
    async afterUpdateContent(ctx) {
      if (ctx.nextNode?.kind !== "file") {
        return;
      }

      try {
        const payload = await buildPythonWorkerNodeContext({
          nodeId: ctx.nextNode.nodeId,
          contentRootDir: input.contentRootDir,
          getNodeById: async () => ctx.nextNode,
          getMountById: input.getMountById,
        });
        await input.request("index_node", payload);
      } catch (error) {
        input.logger.error(
          {
            nodeId: ctx.nextNode.nodeId,
            error: error instanceof Error ? error.message : String(error),
          },
          "failed to dispatch index_node to python worker"
        );
      }
    },

    async afterDelete(ctx) {
      if (ctx.prevNode?.kind !== "file") {
        return;
      }

      try {
        await input.request("delete_node", { nodeId: ctx.prevNode.nodeId });
      } catch (error) {
        input.logger.error(
          {
            nodeId: ctx.prevNode.nodeId,
            error: error instanceof Error ? error.message : String(error),
          },
          "failed to dispatch delete_node to python worker"
        );
      }
    },
  };
}
