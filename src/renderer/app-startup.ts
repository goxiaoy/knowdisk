import type { RendererIndexStatus } from "../shared/index-status";
import type { RendererModelStatus } from "../shared/model-status";
import type { RendererVectorDbStatus } from "../shared/vector-db-status";
import type { RendererVfsStatus } from "../shared/vfs-status";

export async function loadInitialAppState(input: {
  requestWithRetry: <T>(run: () => Promise<T>) => Promise<T>;
  rpc: {
    getModelStatus: () => Promise<RendererModelStatus>;
    getVfsStatus: () => Promise<RendererVfsStatus>;
    getIndexStatus: () => Promise<RendererIndexStatus>;
    getVectorDbStatus: () => Promise<RendererVectorDbStatus>;
  };
}): Promise<{
  modelStatus: RendererModelStatus;
  vfsStatus: RendererVfsStatus;
  indexStatus: RendererIndexStatus;
  vectorDbStatus: RendererVectorDbStatus;
}> {
  const [modelStatus, vfsStatus, indexStatus, vectorDbStatus] = await Promise.all([
    input.requestWithRetry(() => input.rpc.getModelStatus()),
    input.requestWithRetry(() => input.rpc.getVfsStatus()),
    input.requestWithRetry(() => input.rpc.getIndexStatus()),
    input.requestWithRetry(() => input.rpc.getVectorDbStatus()),
  ]);

  return {
    modelStatus,
    vfsStatus,
    indexStatus,
    vectorDbStatus,
  };
}
