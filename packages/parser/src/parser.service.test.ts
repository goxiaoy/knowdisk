import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { VfsOperationCore } from "@knowdisk/vfs";
import { createParserService } from "@knowdisk/parser";

describe("createParserService", () => {
  test("returns the parser service contract", () => {
    const service = createParserService({
      vfs: createVfsStub(),
      basePath: "/tmp/parser-cache",
      logger: createLoggerStub(),
    });

    expect(typeof service.parseNode).toBe("function");
    expect(typeof service.materializeNode).toBe("function");
    expect(typeof service.getCachePaths).toBe("function");
  });

  test("rejects an empty basePath", () => {
    expect(() =>
      createParserService({
        vfs: createVfsStub(),
        basePath: "   ",
        logger: createLoggerStub(),
      }),
    ).toThrow("basePath is required");
  });
});

function createVfsStub(): VfsOperationCore {
  return {
    async listChildren() {
      return { items: [] };
    },
    async getMetadata() {
      return null;
    },
  };
}

function createLoggerStub(): Logger {
  return {
    error() {},
    warn() {},
    info() {},
    debug() {},
    trace() {},
    fatal() {},
    silent: () => undefined,
    child() {
      return createLoggerStub();
    },
    level: "info",
  } as unknown as Logger;
}
