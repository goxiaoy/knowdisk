import { describe, expect, it } from "bun:test";
import { act, create } from "react-test-renderer";
import { SettingsPage } from "./SettingsPage";
import type { AppConfig, ConfigService } from "../../../core/config/config.types";

function makeInitialConfig(): AppConfig {
  return {
    version: 1,
    sources: [],
    mcp: { enabled: true },
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

function makeConfigService(overrides?: Partial<ConfigService>): ConfigService {
  let config = makeInitialConfig();
  const base: ConfigService = {
    getConfig() {
      return config;
    },
    updateConfig(updater) {
      config = updater(config);
      return config;
    },
  };
  return { ...base, ...overrides };
}

describe("SettingsPage", () => {
  it("hides advanced section by default", () => {
    const renderer = create(<SettingsPage pickSourceDirectory={async () => null} configService={makeConfigService()} />);
    const root = renderer.root;

    expect(() => root.findByProps({ children: "Advanced Settings" })).toThrow();

    const button = root.findAllByType("button").find((item) => item.props.children === "Show Advanced");
    expect(button).toBeDefined();
    act(() => {
      button?.props.onClick();
    });

    expect(root.findByProps({ children: "Advanced Settings" })).toBeDefined();
  });

  it("toggles mcp server setting", () => {
    let enabled = true;
    const renderer = create(
      <SettingsPage
        pickSourceDirectory={async () => null}
        configService={makeConfigService({
          getConfig() {
            const cfg = makeInitialConfig();
            cfg.mcp.enabled = enabled;
            return cfg;
          },
          updateConfig(updater) {
            const cfg = makeInitialConfig();
            cfg.mcp.enabled = enabled;
            const next = updater(cfg);
            enabled = next.mcp.enabled;
            return next;
          },
        })}
      />,
    );
    const root = renderer.root;
    const hasText = (text: string) =>
      root
        .findAllByType("p")
        .some((item) => item.children.map((child) => String(child)).join("").includes(text));
    const mcpButton = () =>
      root.findAllByType("button").find((item) => String(item.props.children).includes("Turn MCP"));

    expect(hasText("MCP Server: Enabled")).toBe(true);
    act(() => {
      mcpButton()?.props.onClick();
    });
    expect(hasText("MCP Server: Disabled")).toBe(true);
    expect(enabled).toBe(false);
  });

  it("shows and edits sources", async () => {
    let sources = [
      { path: "/notes", enabled: true },
      { path: "/archive", enabled: false },
    ];
    const renderer = create(
      <SettingsPage
        pickSourceDirectory={async () => "/docs"}
        configService={makeConfigService({
          getConfig() {
            const cfg = makeInitialConfig();
            cfg.sources = sources;
            return cfg;
          },
          updateConfig(updater) {
            const cfg = makeInitialConfig();
            cfg.sources = sources;
            const next = updater(cfg);
            sources = next.sources;
            return next;
          },
        })}
      />, 
    );
    const root = renderer.root;

    expect(root.findByProps({ children: "/notes" })).toBeDefined();
    expect(root.findByProps({ children: "/archive" })).toBeDefined();

    const archiveToggle = root.findByProps({ "data-testid": "toggle-/archive" });
    await act(async () => {
      archiveToggle.props.onChange({ target: { checked: true } });
      await Promise.resolve();
    });
    expect(sources.find((item) => item.path === "/archive")?.enabled).toBe(true);

    const addButton = root.findByProps({ "data-testid": "add-source" });
    await act(async () => {
      await addButton.props.onClick();
    });
    expect(sources.find((item) => item.path === "/docs")).toBeDefined();
    expect(root.findByProps({ children: "Source added. Indexing started." })).toBeDefined();

    const removeButton = root.findByProps({ "data-testid": "remove-/notes" });
    await act(async () => {
      removeButton.props.onClick();
      await Promise.resolve();
    });
    expect(sources.find((item) => item.path === "/notes")).toBeUndefined();
  });

  it("saves embedding and reranker settings", () => {
    let embeddingApiKey = "";
    let rerankerApiKey = "";
    const renderer = create(
      <SettingsPage
        pickSourceDirectory={async () => null}
        configService={makeConfigService({
          updateConfig(updater) {
            const next = updater(makeInitialConfig());
            if (next.embedding.openai_dense.apiKey) {
              embeddingApiKey = next.embedding.openai_dense.apiKey;
            }
            if (next.reranker.openai.apiKey) {
              rerankerApiKey = next.reranker.openai.apiKey;
            }
            return next;
          },
        })}
      />,
    );
    const root = renderer.root;
    const advancedButton = root.findAllByType("button").find((item) => item.props.children === "Show Advanced");
    act(() => {
      advancedButton?.props.onClick();
    });

    const embProvider = root.findByProps({ "data-testid": "embedding-provider" });
    act(() => {
      embProvider.props.onChange({ target: { value: "openai_dense" } });
    });
    const embApi = root.findByProps({ "data-testid": "embedding-cloud-api-key" });
    act(() => {
      embApi.props.onChange({ target: { value: "sk-live-1" } });
    });
    const embModel = root.findByProps({ "data-testid": "embedding-cloud-model" });
    act(() => {
      embModel.props.onChange({ target: { value: "text-embedding-3-small" } });
    });
    const saveEmbedding = root.findByProps({ "data-testid": "save-embedding" });
    act(() => {
      saveEmbedding.props.onClick();
    });

    const rrProvider = root.findByProps({ "data-testid": "reranker-provider" });
    act(() => {
      rrProvider.props.onChange({ target: { value: "openai" } });
    });
    const rrApi = root.findByProps({ "data-testid": "reranker-cloud-api-key" });
    act(() => {
      rrApi.props.onChange({ target: { value: "rk-live-1" } });
    });
    const saveReranker = root.findByProps({ "data-testid": "save-reranker" });
    act(() => {
      saveReranker.props.onClick();
    });

    expect(embeddingApiKey).toBe("sk-live-1");
    expect(rerankerApiKey).toBe("rk-live-1");
  });
});
