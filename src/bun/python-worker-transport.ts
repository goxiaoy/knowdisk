import { EventEmitter } from "node:events";
import { spawn as spawnChild } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  isPythonWorkerEventFrame,
  isPythonWorkerResponseFrame,
  type PythonWorkerEvent,
  type PythonWorkerRequest,
} from "../shared/python-worker";

export type PythonWorkerChildProcess = Pick<
  ChildProcessWithoutNullStreams,
  "stdin" | "stdout" | "stderr" | "kill" | "on"
>;

export type PythonWorkerTransport = {
  start(): void;
  stop(): void;
  request(method: string, params: unknown): Promise<unknown>;
  subscribeEvents(listener: (event: PythonWorkerEvent) => void): () => void;
  subscribeStderr(listener: (chunk: string) => void): () => void;
  subscribeExit(listener: (detail: { code: number | null; signal: NodeJS.Signals | null }) => void): () => void;
};

export function createPythonWorkerTransport(input: {
  command: [string, ...string[]];
  spawn?: (command: string, args: string[]) => PythonWorkerChildProcess;
}): PythonWorkerTransport {
  const emitter = new EventEmitter();
  const spawn = input.spawn ?? ((command, args) => spawnChild(command, args));
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  let child: PythonWorkerChildProcess | null = null;
  let stdoutBuffer = "";
  let requestCount = 0;

  return {
    start() {
      if (child) {
        return;
      }

      const [command, ...args] = input.command;
      child = spawn(command, args);
      child.stdout.setEncoding?.("utf8");
      child.stderr.setEncoding?.("utf8");
      child.stdout.on("data", (chunk: string | Buffer) => {
        handleStdout(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      });
      child.stderr.on("data", (chunk: string | Buffer) => {
        emitter.emit("stderr", typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      });
      child.on("exit", (code, signal) => {
        const reason = `python worker exited (code=${code ?? "null"}, signal=${signal ?? "null"})`;
        rejectAllPending(new Error(reason));
        emitter.emit("exit", { code, signal });
        child = null;
      });
    },

    stop() {
      if (!child) {
        return;
      }
      child.kill();
      child = null;
    },

    request(method, params) {
      ensureStarted();
      const id = `req-${++requestCount}`;
      const frame: PythonWorkerRequest = { id, method, params };
      const payload = `${JSON.stringify(frame)}\n`;

      return new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child!.stdin.write(payload);
      });
    },

    subscribeEvents(listener) {
      emitter.on("event", listener);
      return () => {
        emitter.off("event", listener);
      };
    },

    subscribeStderr(listener) {
      emitter.on("stderr", listener);
      return () => {
        emitter.off("stderr", listener);
      };
    },

    subscribeExit(listener) {
      emitter.on("exit", listener);
      return () => {
        emitter.off("exit", listener);
      };
    },
  };

  function ensureStarted() {
    if (!child) {
      throw new Error("python worker transport has not been started");
    }
  }

  function handleStdout(chunk: string) {
    stdoutBuffer += chunk;
    let newlineIndex = stdoutBuffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        handleLine(line);
      }
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
  }

  function handleLine(line: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      const error = new Error("frame is not valid json");
      rejectAllPending(error);
      emitter.emit("transportError", error);
      return;
    }

    if (isPythonWorkerEventFrame(parsed)) {
      emitter.emit("event", parsed);
      return;
    }

    if (!isPythonWorkerResponseFrame(parsed)) {
      const error = new Error("frame does not match response or event shape");
      rejectAllPending(error);
      emitter.emit("transportError", error);
      return;
    }

    const entry = pending.get(parsed.id);
    if (!entry) {
      return;
    }
    pending.delete(parsed.id);

    if ("error" in parsed) {
      const error = parsed.error;
      if (!error) {
        entry.reject(new Error("python worker response is missing error details"));
        return;
      }
      entry.reject(new Error(error.message));
      return;
    }

    entry.resolve(parsed.result);
  }

  function rejectAllPending(error: Error) {
    for (const [id, entry] of pending) {
      pending.delete(id);
      entry.reject(error);
    }
  }
}
