import { expect, test } from "bun:test";
import { FALLBACK_INDEX_STATUS } from "./index-status";

test("provides a stable fallback index status", () => {
  expect(FALLBACK_INDEX_STATUS).toEqual({
    available: false,
    phase: "idle",
    scope: null,
    processedFiles: 0,
    totalFiles: 0,
    activeNodeName: "",
    error: "",
  });
});
