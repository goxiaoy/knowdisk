import type { AppConfig } from "../core/config/config.types";

export function resolveModelDownloadTriggerReason(
  prev: AppConfig,
  next: AppConfig,
): string | null {
  if (!next.onboarding.completed) {
    return null;
  }
  if (!prev.onboarding.completed) {
    return "onboarding_completed";
  }
  if (hasLocalModelSettingsChanged(prev, next)) {
    return "config_changed";
  }
  if (prev !== next) {
    return "config_updated";
  }
  return null;
}

function hasLocalModelSettingsChanged(prev: AppConfig, next: AppConfig) {
  if (prev.embedding.provider !== next.embedding.provider) {
    return true;
  }
  if (next.embedding.provider === "local") {
    if (prev.embedding.local.model !== next.embedding.local.model) {
      return true;
    }
  }
  if (prev.reranker.enabled !== next.reranker.enabled) {
    return true;
  }
  if (prev.reranker.provider !== next.reranker.provider) {
    return true;
  }
  if (next.reranker.enabled && next.reranker.provider === "local") {
    if (prev.reranker.local.model !== next.reranker.local.model) {
      return true;
    }
  }
  if (prev.model.hfEndpoint !== next.model.hfEndpoint) {
    return true;
  }
  if (prev.model.cacheDir !== next.model.cacheDir) {
    return true;
  }
  return false;
}
