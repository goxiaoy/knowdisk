import type { Logger } from "pino";
import process from "node:process";
import type { Writable } from "node:stream";

type ExampleLoggerInput = {
  stream?: Writable;
  name?: string;
};

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

export function createExampleLogger(input?: ExampleLoggerInput): Logger {
  const stream = input?.stream ?? process.stdout;
  const name = input?.name ?? "knowdisk.vfs.example";

  const write = (level: LogLevel, obj?: unknown, msg?: string) => {
    const parts = [
      new Date().toLocaleTimeString("en-GB", { hour12: false }),
      `[${LEVEL_LABELS[level]}]`,
      name,
    ];
    if (msg && msg.length > 0) {
      parts.push(msg);
    }
    const fields = formatFields(obj);
    if (fields.length > 0) {
      parts.push(fields.join(" "));
    }
    stream.write(`${parts.join(" ")}\n`);
  };

  return {
    debug(obj: unknown, msg?: string) {
      write("debug", obj, msg);
    },
    info(obj: unknown, msg?: string) {
      write("info", obj, msg);
    },
    warn(obj: unknown, msg?: string) {
      write("warn", obj, msg);
    },
    error(obj: unknown, msg?: string) {
      write("error", obj, msg);
    },
  } as Logger;
}

function formatFields(obj: unknown): string[] {
  if (!obj || typeof obj !== "object") {
    return [];
  }
  return Object.entries(obj as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`);
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value.includes(" ") ? JSON.stringify(value) : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  if (value instanceof Error) {
    return value.message;
  }
  return JSON.stringify(value);
}
