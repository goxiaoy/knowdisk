import { describe, expect, it } from "bun:test";
import { act, create } from "react-test-renderer";
import { SettingsPage } from "./SettingsPage";
import type { AppConfig, ConfigService } from "../../../core/config/config.types";
import { getDefaultConfig } from "../../../core/config/config.service";

function makeInitialConfig(): AppConfig {
  const cfg = getDefaultConfig();
  return {
    ...cfg,
    onboarding: { completed: true },
    sources: [],
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
    subscribe() {
      return () => {};
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
    let port = 3467;
    const renderer = create(
      <SettingsPage
        pickSourceDirectory={async () => null}
        configService={makeConfigService({
          getConfig() {
            const cfg = makeInitialConfig();
            cfg.mcp.enabled = enabled;
            cfg.mcp.port = port;
            return cfg;
          },
          updateConfig(updater) {
            const cfg = makeInitialConfig();
            cfg.mcp.enabled = enabled;
            cfg.mcp.port = port;
            const next = updater(cfg);
            enabled = next.mcp.enabled;
            port = next.mcp.port;
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

    const mcpPort = root.findByProps({ "data-testid": "mcp-port" });
    act(() => {
      mcpPort.props.onChange({ target: { value: "4567" } });
    });
    const saveMcp = root.findByProps({ "data-testid": "save-mcp" });
    act(() => {
      saveMcp.props.onClick();
    });
    expect(port).toBe(4567);
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

  it("loads cloud embedding and reranker fields from config", () => {
    const config = makeInitialConfig();
    config.embedding.provider = "openai_dense";
    config.embedding.openai_dense = {
      apiKey: "sk-config",
      model: "text-embedding-3-large",
      dimension: 3072,
    };
    config.reranker.provider = "openai";
    config.reranker.openai = {
      apiKey: "rk-config",
      model: "text-rerank-1",
      topN: 9,
    };

    const renderer = create(
      <SettingsPage
        pickSourceDirectory={async () => null}
        configService={makeConfigService({
          getConfig() {
            return config;
          },
        })}
      />,
    );
    const root = renderer.root;
    const advancedButton = root.findAllByType("button").find((item) => item.props.children === "Show Advanced");
    act(() => {
      advancedButton?.props.onClick();
    });

    expect(root.findByProps({ "data-testid": "embedding-cloud-api-key" }).props.value).toBe("sk-config");
    expect(root.findByProps({ "data-testid": "embedding-cloud-model" }).props.value).toBe("text-embedding-3-large");
    expect(root.findByProps({ "data-testid": "embedding-cloud-dimension" }).props.value).toBe("3072");

    expect(root.findByProps({ "data-testid": "reranker-cloud-api-key" }).props.value).toBe("rk-config");
    expect(root.findByProps({ "data-testid": "reranker-cloud-model" }).props.value).toBe("text-rerank-1");
    expect(root.findByProps({ "data-testid": "reranker-cloud-topn" }).props.value).toBe("9");
  });

  it("saves shared model runtime settings", () => {
    let modelHfEndpoint = "";
    let modelCacheDir = "";
    const renderer = create(
      <SettingsPage
        pickSourceDirectory={async () => null}
        configService={makeConfigService({
          updateConfig(updater) {
            const next = updater(makeInitialConfig());
            modelHfEndpoint = next.model.hfEndpoint;
            modelCacheDir = next.model.cacheDir;
            return next;
          },
        })}
      />,
    );
    const root = renderer.root;
    const endpoint = root.findByProps({ "data-testid": "model-hf-endpoint" });
    act(() => {
      endpoint.props.onChange({ target: { value: "https://example-hf.local" } });
    });
    const cacheDir = root.findByProps({ "data-testid": "model-cache-dir" });
    act(() => {
      cacheDir.props.onChange({ target: { value: "/tmp/knowdisk-models" } });
    });
    const save = root.findByProps({ "data-testid": "save-model" });
    act(() => {
      save.props.onClick();
    });

    expect(modelHfEndpoint).toBe("https://example-hf.local");
    expect(modelCacheDir).toBe("/tmp/knowdisk-models");
  });

  it("saves chat model and api key settings", async () => {
    let chatModel = "";
    let chatApiKey = "";
    let chatDomain = "";
    const renderer = create(
      <SettingsPage
        pickSourceDirectory={async () => null}
        configService={makeConfigService({
          updateConfig(updater) {
            const next = updater(makeInitialConfig());
            chatModel = next.chat.openai.model;
            chatApiKey = next.chat.openai.apiKey;
            chatDomain = next.chat.openai.domain;
            return next;
          },
        })}
      />,
    );

    const root = renderer.root;
    const model = root.findByProps({ "data-testid": "chat-model" });
    await act(async () => {
      model.props.onChange({ target: { value: "gpt-4.1" } });
    });
    const key = root.findByProps({ "data-testid": "chat-api-key" });
    await act(async () => {
      key.props.onChange({ target: { value: "sk-chat-test" } });
    });
    const domain = root.findByProps({ "data-testid": "chat-domain" });
    await act(async () => {
      domain.props.onChange({ target: { value: "https://example-openai.local/" } });
    });
    const save = root.findByProps({ "data-testid": "save-chat" });
    await act(async () => {
      save.props.onClick();
      await Promise.resolve();
    });

    expect(chatModel).toBe("gpt-4.1");
    expect(chatApiKey).toBe("sk-chat-test");
    expect(chatDomain).toBe("https://example-openai.local");
  });

  it("syncs latest chat model from api and persists it", async () => {
    let persistedModel = "";
    const renderer = create(
      <SettingsPage
        pickSourceDirectory={async () => null}
        fetchChatModels={async () => ["gpt-4.1-latest", "gpt-4.1-mini"]}
        configService={makeConfigService({
          updateConfig(updater) {
            const next = updater(makeInitialConfig());
            persistedModel = next.chat.openai.model;
            return next;
          },
        })}
      />,
    );

    const root = renderer.root;
    const key = root.findByProps({ "data-testid": "chat-api-key" });
    const domain = root.findByProps({ "data-testid": "chat-domain" });
    await act(async () => {
      key.props.onChange({ target: { value: "sk-chat-test" } });
      domain.props.onChange({ target: { value: "https://api.openai.com" } });
      await Promise.resolve();
    });

    expect(persistedModel).toBe("gpt-4.1-latest");
    expect(root.findByProps({ "data-testid": "chat-model" }).props.value).toBe("gpt-4.1-latest");
  });
});
