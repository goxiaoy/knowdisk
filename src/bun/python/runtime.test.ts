import { describe, expect, mock, test } from "bun:test";
import { tmpdir } from "node:os";
import type { PythonWorkerCoreConfig } from "../../shared/python-worker";
import {
  createPythonWorkerRuntime,
  type PythonWorkerRuntimeStartupConfig,
  type PythonWorkerRuntimeTransport,
} from "./runtime";

function createFakeTransport(): PythonWorkerRuntimeTransport & {
  emitEvent(event: { type: string; payload: unknown }): void;
  emitExit(detail: { code: number | null; signal: NodeJS.Signals | null }): void;
  emitStderr(chunk: string): void;
  requests: Array<{ method: string; params: unknown }>;
  started: number;
  stopped: number;
} {
  const eventListeners = new Set<(event: { type: string; payload: unknown }) => void>();
  const stderrListeners = new Set<(chunk: string) => void>();
  const exitListeners = new Set<
    (detail: { code: number | null; signal: NodeJS.Signals | null }) => void
  >();
  const requests: Array<{ method: string; params: unknown }> = [];
  let started = 0;
  let stopped = 0;

  return {
    requests,
    get started() {
      return started;
    },
    get stopped() {
      return stopped;
    },
    start() {
      started += 1;
    },
    stop() {
      stopped += 1;
    },
    async request(method, params) {
      requests.push({ method, params });
      if (method === "get_status_snapshot") {
        return {
          model_status: { phase: "idle" },
          index_status: { phase: "idle" },
          vector_status: { chunkCount: 0 },
        };
      }
      return { ok: true };
    },
    subscribeEvents(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    subscribeStderr(listener) {
      stderrListeners.add(listener);
      return () => stderrListeners.delete(listener);
    },
    subscribeExit(listener) {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
    emitEvent(event) {
      for (const listener of eventListeners) {
        listener(event);
      }
    },
    emitStderr(chunk) {
      for (const listener of stderrListeners) {
        listener(chunk);
      }
    },
    emitExit(detail) {
      for (const listener of exitListeners) {
        listener(detail);
      }
    },
  };
}

function createStartupConfig(overrides: Partial<PythonWorkerRuntimeStartupConfig> = {}): PythonWorkerRuntimeStartupConfig {
  return {
    basePath: "/tmp/knowdisk",
    embeddingModel: "Alibaba-NLP/gte-multilingual-base",
    rerankerModel: "Alibaba-NLP/gte-multilingual-reranker-base",
    preferredDevice: "cpu",
    ...overrides,
  };
}

function createCoreConfigSubset(): PythonWorkerCoreConfig {
  return {
    embedding: {
      provider: "local",
      local: {
        model: "Alibaba-NLP/gte-multilingual-base",
        dimension: 768,
      },
    },
    reranker: {
      enabled: true,
      provider: "local",
      local: {
        model: "Alibaba-NLP/gte-multilingual-reranker-base",
        topN: 5,
      },
    },
    ocr: {
      provider: "local",
      local: {
        model: "PaddlePaddle/PaddleOCR-VL",
      },
    },
    caption: {
      provider: "local",
      local: {
        model: "vikhyatk/moondream2",
      },
    },
    providers: {
      huggingface: {
        endpoint: "https://hf-mirror.com",
      },
    },
  };
}

describe("createPythonWorkerRuntime", () => {
  test("starts transport and hydrates status snapshot", async () => {
    const transport = createFakeTransport();
    const listener = mock(() => {});
    const runtime = createPythonWorkerRuntime({
      transport,
      maxRestarts: 2,
      startupConfig: createStartupConfig(),
    });

    runtime.subscribeStatusEvents(listener);
    await runtime.start();

    expect(transport.started).toBe(1);
    expect(transport.requests).toEqual([
      {
        method: "start",
        params: createStartupConfig(),
      },
      { method: "get_status_snapshot", params: {} },
    ]);
    expect(listener).toHaveBeenCalledWith({
      type: "statusSnapshot",
      payload: {
        model_status: { phase: "idle" },
        index_status: { phase: "idle" },
        vector_status: { chunkCount: 0 },
      },
    });
  });

  test("restarts after unexpected exit and rehydrates snapshot", async () => {
    const transport = createFakeTransport();
    const runtime = createPythonWorkerRuntime({
      transport,
      maxRestarts: 2,
      startupConfig: createStartupConfig(),
    });

    await runtime.start();
    transport.emitExit({ code: 2, signal: null });
    await Promise.resolve();

    expect(transport.started).toBe(2);
    expect(
      transport.requests.filter((entry) => entry.method === "get_status_snapshot").length
    ).toBe(2);
  });

  test("stops transport without restarting after shutdown", async () => {
    const transport = createFakeTransport();
    const runtime = createPythonWorkerRuntime({
      transport,
      maxRestarts: 2,
      startupConfig: createStartupConfig(),
    });

    await runtime.start();
    await runtime.stop();
    transport.emitExit({ code: 0, signal: null });
    await Promise.resolve();

    expect(transport.stopped).toBe(1);
    expect(transport.started).toBe(1);
  });

  test("defaults startup basePath outside the repository cwd", async () => {
    const transport = createFakeTransport();
    const runtime = createPythonWorkerRuntime({
      transport,
      maxRestarts: 0,
    });

    await runtime.start();

    expect(transport.requests[0]?.method).toBe("start");
    expect((transport.requests[0]?.params as { basePath: string }).basePath).toStartWith(
      tmpdir()
    );
  });

  test("passes optional coreConfig subset through the start request", async () => {
    const transport = createFakeTransport();
    const runtime = createPythonWorkerRuntime({
      transport,
      maxRestarts: 0,
      startupConfig: createStartupConfig({
        coreConfig: createCoreConfigSubset(),
        huggingfaceEndpoint: "https://hf-mirror.com",
      }),
    });

    await runtime.start();

    expect(transport.requests[0]).toEqual({
      method: "start",
      params: createStartupConfig({
        coreConfig: createCoreConfigSubset(),
        huggingfaceEndpoint: "https://hf-mirror.com",
      }),
    });
  });
});
