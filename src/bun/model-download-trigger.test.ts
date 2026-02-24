import { expect, test } from "bun:test";
import { getDefaultConfig } from "../core/config/config.service";
import { resolveModelDownloadTriggerReason } from "./model-download-trigger";

test("returns onboarding_completed when onboarding flips to completed", () => {
  const prev = getDefaultConfig();
  const next = { ...prev, onboarding: { completed: true } };
  expect(resolveModelDownloadTriggerReason(prev, next)).toBe(
    "onboarding_completed",
  );
});

test("returns null when onboarding is still incomplete", () => {
  const prev = getDefaultConfig();
  const next = { ...prev };
  expect(resolveModelDownloadTriggerReason(prev, next)).toBeNull();
});

test("returns config_changed when local model config changes after onboarding", () => {
  const prev = { ...getDefaultConfig(), onboarding: { completed: true } };
  const next = {
    ...prev,
    embedding: {
      ...prev.embedding,
      local: { ...prev.embedding.local, model: "onnx-community/gte-base" },
    },
  };
  expect(resolveModelDownloadTriggerReason(prev, next)).toBe("config_changed");
});

test("returns config_updated for other config changes after onboarding", () => {
  const prev = { ...getDefaultConfig(), onboarding: { completed: true } };
  const next = {
    ...prev,
    sources: [...prev.sources, { path: "/docs", enabled: true }],
  };
  expect(resolveModelDownloadTriggerReason(prev, next)).toBe("config_updated");
});
