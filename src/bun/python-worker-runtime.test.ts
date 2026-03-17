import { describe, expect, mock, test } from "bun:test";
import {
  createPythonWorkerRuntime,
  type PythonWorkerRuntimeTransport,
} from "./python-worker-runtime";

function createFakeTransport(): PythonWorkerRuntimeTransport & {
  emitEvent(event: { type: string; payload: unknown }): void;
  emitExit(detail: { code: number | null; signal: NodeJS.Signals | null }): void;
  requests: Array<{ method: string; params: unknown }>;
  started: number;
  stopped: number;
} {
  const eventListeners = new Set<(event: { type: string; payload: unknown }) => void>();
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
    subscribeExit(listener) {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
    emitEvent(event) {
      for (const listener of eventListeners) {
        listener(event);
      }
    },
    emitExit(detail) {
      for (const listener of exitListeners) {
        listener(detail);
      }
    },
  };
}

describe("createPythonWorkerRuntime", () => {
  test("starts transport and hydrates status snapshot", async () => {
    const transport = createFakeTransport();
    const listener = mock(() => {});
    const runtime = createPythonWorkerRuntime({ transport, maxRestarts: 2 });

    runtime.subscribeStatusEvents(listener);
    await runtime.start();

    expect(transport.started).toBe(1);
    expect(transport.requests).toEqual([
      { method: "start", params: {} },
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
    const runtime = createPythonWorkerRuntime({ transport, maxRestarts: 2 });

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
    const runtime = createPythonWorkerRuntime({ transport, maxRestarts: 2 });

    await runtime.start();
    await runtime.stop();
    transport.emitExit({ code: 0, signal: null });
    await Promise.resolve();

    expect(transport.stopped).toBe(1);
    expect(transport.started).toBe(1);
  });
});
