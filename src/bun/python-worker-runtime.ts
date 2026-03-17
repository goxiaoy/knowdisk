import type { PythonWorkerEvent } from "../shared/python-worker";
import type { PythonWorkerTransport } from "./python-worker-transport";

export type PythonWorkerRuntimeTransport = Pick<
  PythonWorkerTransport,
  "start" | "stop" | "request" | "subscribeEvents" | "subscribeExit"
>;

export type PythonWorkerRuntime = {
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribeStatusEvents(
    listener: (event: { type: "statusSnapshot"; payload: unknown } | PythonWorkerEvent) => void
  ): () => void;
};

export function createPythonWorkerRuntime(input: {
  transport: PythonWorkerRuntimeTransport;
  maxRestarts: number;
}): PythonWorkerRuntime {
  const listeners = new Set<
    (event: { type: "statusSnapshot"; payload: unknown } | PythonWorkerEvent) => void
  >();
  let stopping = false;
  let restartCount = 0;
  let started = false;

  input.transport.subscribeEvents((event) => {
    for (const listener of listeners) {
      listener(event);
    }
  });
  input.transport.subscribeExit(() => {
    if (stopping || restartCount >= input.maxRestarts) {
      return;
    }
    restartCount += 1;
    void startWorker();
  });

  return {
    async start() {
      stopping = false;
      restartCount = 0;
      await startWorker();
    },

    async stop() {
      stopping = true;
      if (!started) {
        return;
      }
      input.transport.stop();
      started = false;
    },

    subscribeStatusEvents(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  async function startWorker() {
    input.transport.start();
    started = true;
    await input.transport.request("start", {});
    const snapshot = await input.transport.request("get_status_snapshot", {});
    for (const listener of listeners) {
      listener({
        type: "statusSnapshot",
        payload: snapshot,
      });
    }
  }
}
