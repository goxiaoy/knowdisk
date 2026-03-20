import { afterEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
  createPythonWorkerTransport,
  type PythonWorkerChildProcess,
} from "./transport";

class FakeStream extends EventEmitter {
  writes: string[] = [];

  write(chunk: string | Uint8Array) {
    this.writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }

  setEncoding() {}
}

class FakeChildProcess extends EventEmitter implements PythonWorkerChildProcess {
  readonly stdin = new FakeStream();
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  killed = false;

  kill() {
    this.killed = true;
    this.emit("exit", 0, null);
    return true;
  }
}

afterEach(() => {
  mock.restore();
});

describe("createPythonWorkerTransport", () => {
  test("spawns the configured python worker command on start", () => {
    const child = new FakeChildProcess();
    const spawn = mock(() => child);
    const transport = createPythonWorkerTransport({
      command: ["python3", "-m", "worker"],
      spawn,
    });

    transport.start();

    expect(spawn).toHaveBeenCalledWith("python3", ["-m", "worker"]);
  });

  test("correlates responses by request id", async () => {
    const child = new FakeChildProcess();
    const transport = createPythonWorkerTransport({
      command: ["python3", "-m", "worker"],
      spawn: () => child,
    });

    transport.start();
    const pending = transport.request("start", { ready: true });
    const raw = child.stdin.writes[0];
    const frame = JSON.parse(raw);
    child.stdout.emit("data", `${JSON.stringify({ id: frame.id, result: { ok: true } })}\n`);

    await expect(pending).resolves.toEqual({ ok: true });
  });

  test("emits parsed event frames to subscribers", () => {
    const child = new FakeChildProcess();
    const transport = createPythonWorkerTransport({
      command: ["python3", "-m", "worker"],
      spawn: () => child,
    });
    const listener = mock(() => {});

    transport.subscribeEvents(listener);
    transport.start();
    child.stdout.emit(
      "data",
      `${JSON.stringify({ type: "index_status_changed", payload: { phase: "indexing" } })}\n`
    );

    expect(listener).toHaveBeenCalledWith({
      type: "index_status_changed",
      payload: { phase: "indexing" },
    });
  });

  test("rejects pending requests when receiving malformed frames", async () => {
    const child = new FakeChildProcess();
    const transport = createPythonWorkerTransport({
      command: ["python3", "-m", "worker"],
      spawn: () => child,
    });

    transport.start();
    const pending = transport.request("start", {});
    child.stdout.emit("data", "not-json\n");

    await expect(pending).rejects.toThrow("frame is not valid json");
  });

  test("rejects pending requests when the worker exits", async () => {
    const child = new FakeChildProcess();
    const transport = createPythonWorkerTransport({
      command: ["python3", "-m", "worker"],
      spawn: () => child,
    });

    transport.start();
    const pending = transport.request("index_node", { nodeId: "node-1" });
    child.emit("exit", 2, null);

    await expect(pending).rejects.toThrow("python worker exited");
  });

  test("notifies exit subscribers when the worker exits", () => {
    const child = new FakeChildProcess();
    const transport = createPythonWorkerTransport({
      command: ["python3", "-m", "worker"],
      spawn: () => child,
    });
    const listener = mock(() => {});

    transport.subscribeExit(listener);
    transport.start();
    child.emit("exit", 2, "SIGTERM");

    expect(listener).toHaveBeenCalledWith({ code: 2, signal: "SIGTERM" });
  });

  test("emits stderr chunks to subscribers", () => {
    const child = new FakeChildProcess();
    const transport = createPythonWorkerTransport({
      command: ["python3", "-m", "worker"],
      spawn: () => child,
    });
    const listener = mock(() => {});

    transport.subscribeStderr(listener);
    transport.start();
    child.stderr.emit("data", '{"level":"info","msg":"worker started"}\n');

    expect(listener).toHaveBeenCalledWith('{"level":"info","msg":"worker started"}\n');
  });
});
