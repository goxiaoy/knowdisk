import { expect, test } from "bun:test";
import { getDefaultConfig } from "../core/config/config.service";
import { shouldTriggerModelDownload } from "./model-download-trigger";

test("returns true when onboarding flips to completed", () => {
  const prev = getDefaultConfig();
  const next = { ...prev, onboarding: { completed: true } };
  expect(shouldTriggerModelDownload(prev, next)).toBe(true);
});

test("returns false when config object is unchanged", () => {
  const prev = getDefaultConfig();
  const next = prev;
  expect(shouldTriggerModelDownload(prev, next)).toBe(false);
});

test("returns true when local model config changes", () => {
  const prev = getDefaultConfig();
  const next = {
    ...prev,
    embedding: {
      ...prev.embedding,
      local: { ...prev.embedding.local, model: "onnx-community/gte-base" },
    },
  };
  expect(shouldTriggerModelDownload(prev, next)).toBe(true);
});

test("returns true for other config changes", () => {
  const prev = getDefaultConfig();
  const next = {
    ...prev,
    sources: [...prev.sources, { path: "/docs", enabled: true }],
  };
  expect(shouldTriggerModelDownload(prev, next)).toBe(true);
});
