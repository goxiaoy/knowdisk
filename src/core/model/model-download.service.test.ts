import { expect, test } from "bun:test";
import { resolveRangeNotSatisfiableStrategy } from "./model-download.service";

test("resolveRangeNotSatisfiableStrategy promotes partial when offsets match", () => {
  expect(resolveRangeNotSatisfiableStrategy(1024, 1024)).toBe("promote_partial");
});

test("resolveRangeNotSatisfiableStrategy restarts when partial is larger", () => {
  expect(resolveRangeNotSatisfiableStrategy(2048, 1024)).toBe("restart");
});

test("resolveRangeNotSatisfiableStrategy restarts when remote size is unknown", () => {
  expect(resolveRangeNotSatisfiableStrategy(1024, 0)).toBe("restart");
});
