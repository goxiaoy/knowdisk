import { describe, expect, test } from "bun:test";
import { sanitizePythonWorkerStderrLine } from "./logging";

describe("sanitizePythonWorkerStderrLine", () => {
  test("strips ansi escape codes from python stderr lines", () => {
    expect(
      sanitizePythonWorkerStderrLine(
        '\u001b[1;35mModuleNotFoundError\u001b[0m: \u001b[35mNo module named "zvec"\u001b[0m'
      )
    ).toBe('ModuleNotFoundError: No module named "zvec"');
  });
});
