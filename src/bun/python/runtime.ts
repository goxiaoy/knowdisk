import type { PythonWorkerEvent } from "../../shared/python-worker";
import type { PythonWorkerTransport } from "./transport";

export type PythonWorkerRuntimeTransport = Pick<
  PythonWorkerTransport,
  "start" | "stop" | "request" | "subscribeEvents" | "subscribeStderr" | "subscribeExit"
>;

export type PythonWorkerRuntime = {
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribeStatusEvents(
    listener: (event: { type: "statusSnapshot"; payload: unknown } | PythonWorkerEvent) => void
  ): () => void;
};

export type PythonWorkerRuntimeStartupConfig = {
  basePath: string;
  embeddingModel: string;
  rerankerModel: string;
  preferredDevice: "cpu" | "mps" | "cuda";
  huggingfaceEndpoint?: string;
};

function createDefaultPythonWorkerRuntimeStartupConfig(): PythonWorkerRuntimeStartupConfig {
  return {
    basePath: process.cwd(),
    embeddingModel: "Alibaba-NLP/gte-multilingual-base",
    rerankerModel: "Alibaba-NLP/gte-multilingual-reranker-base",
    preferredDevice: process.platform === "darwin" ? "mps" : "cpu",
  };
}

export function createPythonWorkerRuntime(input: {
  transport: PythonWorkerRuntimeTransport;
  maxRestarts: number;
  startupConfig?: PythonWorkerRuntimeStartupConfig;
}): PythonWorkerRuntime {
  const startupConfig = input.startupConfig ?? createDefaultPythonWorkerRuntimeStartupConfig();
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
    await input.transport.request("start", startupConfig);
    const snapshot = await input.transport.request("get_status_snapshot", {});
    for (const listener of listeners) {
      listener({
        type: "statusSnapshot",
        payload: snapshot,
      });
    }
  }
}
