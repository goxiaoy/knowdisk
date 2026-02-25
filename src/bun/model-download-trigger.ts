import type { AppConfig } from "../core/config/config.types";

export function shouldTriggerModelDownload(
  prev: AppConfig,
  next: AppConfig,
): boolean {
  if (!next.onboarding.completed) {
    return false;
  }
  if (!prev.onboarding.completed) {
    return true;
  }
  if (hasLocalModelSettingsChanged(prev, next)) {
    return true;
  }
  if (prev !== next) {
    return true;
  }
  return false;
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
