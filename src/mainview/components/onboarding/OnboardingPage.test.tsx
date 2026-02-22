import { describe, expect, it } from "bun:test";
import { act, create } from "react-test-renderer";
import { OnboardingPage } from "./OnboardingPage";
import type { AppConfig, ConfigService } from "../../../core/config/config.types";

function makeInitialConfig(): AppConfig {
  return {
    version: 1,
    onboarding: { completed: false },
    sources: [],
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

function makeConfigService(): ConfigService {
  let config = makeInitialConfig();
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

describe("OnboardingPage", () => {
  it("disables next when no source is configured", () => {
    const renderer = create(
      <OnboardingPage configService={makeConfigService()} pickSourceDirectory={async () => null} />,
    );
    const root = renderer.root;
    const next = root.findByProps({ "data-testid": "onboarding-next" });
    expect(next.props.disabled).toBe(true);
  });

  it("allows moving to step 2 after adding a source", async () => {
    const renderer = create(
      <OnboardingPage configService={makeConfigService()} pickSourceDirectory={async () => "/docs"} />,
    );
    const root = renderer.root;

    const add = root.findByProps({ "data-testid": "onboarding-add-source" });
    await act(async () => {
      await add.props.onClick();
    });

    const next = root.findByProps({ "data-testid": "onboarding-next" });
    expect(next.props.disabled).toBe(false);

    await act(async () => {
      next.props.onClick();
    });

    expect(root.findByProps({ children: "Step 2: Embedding & Reranker" })).toBeDefined();
  });

  it("completes onboarding from step 2 without requiring edits", async () => {
    let finished = false;
    const configService = makeConfigService();
    const renderer = create(
      <OnboardingPage
        configService={configService}
        pickSourceDirectory={async () => "/docs"}
        onFinished={() => {
          finished = true;
        }}
      />,
    );
    const root = renderer.root;

    await act(async () => {
      await root.findByProps({ "data-testid": "onboarding-add-source" }).props.onClick();
    });

    await act(async () => {
      root.findByProps({ "data-testid": "onboarding-next" }).props.onClick();
    });

    await act(async () => {
      await root.findByProps({ "data-testid": "onboarding-complete" }).props.onClick();
    });

    expect(configService.getConfig().onboarding.completed).toBe(true);
    expect(finished).toBe(true);
  });
});
