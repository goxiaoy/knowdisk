import { expect, test } from "bun:test";
import { isDevelopmentChannel } from "./runtime-mode";

test("treats dev channel as development mode", () => {
  expect(isDevelopmentChannel("dev")).toBe(true);
});

test("treats non-dev channels as packaged mode", () => {
  expect(isDevelopmentChannel("prod")).toBe(false);
  expect(isDevelopmentChannel("beta")).toBe(false);
});
