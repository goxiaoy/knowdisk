import { describe, expect, mock, test } from "bun:test";
import { startBackgroundServices } from "./startup";

describe("startBackgroundServices", () => {
  test("starts vfs after python worker runtime and app runtime are ready", async () => {
    const calls: string[] = [];

    await startBackgroundServices({
      pythonWorkerRuntime: {
        start: mock(async () => {
          calls.push("python-runtime");
        }),
      },
      pythonWorkerAppRuntime: {
        start: mock(async () => {
          calls.push("python-app");
        }),
      },
      vfs: {
        start: mock(async () => {
          calls.push("vfs");
        }),
      },
      logger: {
        error() {},
      },
    });

    expect(calls).toEqual(["python-runtime", "python-app", "vfs"]);
  });
});
