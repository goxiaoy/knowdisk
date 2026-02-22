import { describe, expect, it } from "bun:test";
import { create } from "react-test-renderer";
import App from "./App";
import type { AppConfig, ConfigService } from "../core/config/config.types";

function makeConfig(completed: boolean): AppConfig {
  return {
    version: 1,
    onboarding: { completed },
    sources: completed ? [{ path: "/docs", enabled: true }] : [],
    mcp: { enabled: true, port: 3467 },
    ui: { mode: "safe" },
    indexing: { watch: { enabled: true } },
    embedding: {
      provider: "local",
      local: {
        hfEndpoint: "https://hf-mirror.com",
        cacheDir: "build/cache/embedding/local",
        model: "Xenova/all-MiniLM-L6-v2",
        dimension: 384,
      },
      qwen_dense: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
      qwen_sparse: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
      openai_dense: { apiKey: "", model: "text-embedding-3-small", dimension: 1536 },
    },
    reranker: {
      enabled: true,
      provider: "local",
      local: {
        hfEndpoint: "https://hf-mirror.com",
        cacheDir: "build/cache/reranker/local",
        model: "BAAI/bge-reranker-base",
        topN: 5,
      },
      qwen: { apiKey: "", model: "gte-rerank-v2", topN: 5 },
      openai: { apiKey: "", model: "text-embedding-3-small", topN: 5 },
    },
  };
}

function makeConfigService(completed: boolean): ConfigService {
  let config = makeConfig(completed);
  return {
    getConfig() {
      return config;
    },
    updateConfig(updater) {
      config = updater(config);
      return config;
    },
  };
}

describe("App", () => {
  it("shows onboarding when onboarding is not completed", () => {
    const renderer = create(<App configService={makeConfigService(false)} />);
    expect(renderer.root.findByProps({ children: "Welcome to Know Disk" })).toBeDefined();
  });

  it("shows app shell when onboarding is completed", () => {
    const renderer = create(<App configService={makeConfigService(true)} />);
    expect(renderer.root.findByProps({ children: "Home" })).toBeDefined();
    expect(renderer.root.findByProps({ children: "Settings" })).toBeDefined();
  });
});
