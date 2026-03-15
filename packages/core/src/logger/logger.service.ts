import pino from "pino";
import type { LoggerService } from "./logger.service.types";

export function createLoggerService(opts?: {
  name?: string;
  level?: string;
}): LoggerService {
  return pino({
    name: opts?.name ?? "knowdisk",
    level: opts?.level ?? process.env.LOG_LEVEL ?? "info",
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });
}
