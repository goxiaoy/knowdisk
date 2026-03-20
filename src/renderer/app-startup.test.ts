import { expect, mock, test } from "bun:test";
import { loadInitialAppState } from "./app-startup";
import { FALLBACK_INDEX_STATUS } from "../shared/index-status";
import { FALLBACK_MODEL_STATUS } from "../shared/model-status";
import { FALLBACK_VECTOR_DB_STATUS } from "../shared/vector-db-status";
import { FALLBACK_VFS_STATUS } from "../shared/vfs-status";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("loads startup statuses in parallel", async () => {
  const model = deferred<typeof FALLBACK_MODEL_STATUS>();
  const vfs = deferred<typeof FALLBACK_VFS_STATUS>();
  const index = deferred<typeof FALLBACK_INDEX_STATUS>();
  const vector = deferred<typeof FALLBACK_VECTOR_DB_STATUS>();

  const rpc = {
    getModelStatus: mock(async () => model.promise),
    getVfsStatus: mock(async () => vfs.promise),
    getIndexStatus: mock(async () => index.promise),
    getVectorDbStatus: mock(async () => vector.promise),
  };

  const loading = loadInitialAppState({
    requestWithRetry: async (run) => run(),
    rpc,
  });

  expect(rpc.getModelStatus).toHaveBeenCalledTimes(1);
  expect(rpc.getVfsStatus).toHaveBeenCalledTimes(1);
  expect(rpc.getIndexStatus).toHaveBeenCalledTimes(1);
  expect(rpc.getVectorDbStatus).toHaveBeenCalledTimes(1);

  model.resolve(FALLBACK_MODEL_STATUS);
  vfs.resolve(FALLBACK_VFS_STATUS);
  index.resolve(FALLBACK_INDEX_STATUS);
  vector.resolve(FALLBACK_VECTOR_DB_STATUS);

  const loaded = await loading;
  expect(loaded).toEqual({
    modelStatus: FALLBACK_MODEL_STATUS,
    vfsStatus: FALLBACK_VFS_STATUS,
    indexStatus: FALLBACK_INDEX_STATUS,
    vectorDbStatus: FALLBACK_VECTOR_DB_STATUS,
  });
});
