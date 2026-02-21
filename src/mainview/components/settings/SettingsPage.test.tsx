import { describe, expect, it } from "bun:test";
import { act, create } from "react-test-renderer";
import { SettingsPage } from "./SettingsPage";
import type { ConfigService } from "../../../core/config/config.types";

function makeConfigService(overrides?: Partial<ConfigService>): ConfigService {
  let enabled = true;
  let sources: Array<{ path: string; enabled: boolean }> = [];
  let embedding = {
    provider: "local" as const,
    endpoint: "",
    apiKeys: {} as Record<string, string>,
    dimension: 384,
  };
  let modelHub = { hfEndpoint: "https://hf-mirror.com" };
  let reranker = { mode: "local" as const, model: "BAAI/bge-reranker-base", topN: 5 };

  const base: ConfigService = {
    getConfig() {
      return {
        version: 1,
        sources,
        mcp: { enabled },
        ui: { mode: "safe" as const },
        indexing: { watch: { enabled: true } },
        embedding,
        modelHub,
        reranker,
      };
    },
    getMcpEnabled() {
      return enabled;
    },
    setMcpEnabled(next: boolean) {
      enabled = next;
      return this.getConfig();
    },
    getSources() {
      return sources;
    },
    addSource(path: string) {
      if (!sources.find((item) => item.path === path)) {
        sources = [...sources, { path, enabled: true }];
      }
      return sources;
    },
    updateSource(path: string, nextEnabled: boolean) {
      sources = sources.map((item) => (item.path === path ? { ...item, enabled: nextEnabled } : item));
      return sources;
    },
    removeSource(path: string) {
      sources = sources.filter((item) => item.path !== path);
      return sources;
    },
    updateEmbedding(input) {
      embedding = {
        ...embedding,
        ...input,
        apiKeys: { ...embedding.apiKeys, ...(input.apiKeys ?? {}) },
      };
      return this.getConfig();
    },
    updateModelHub(input) {
      modelHub = { ...modelHub, ...input };
      return this.getConfig();
    },
    updateReranker(input) {
      reranker = { ...reranker, ...input };
      return this.getConfig();
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
          getMcpEnabled() {
            return enabled;
          },
          setMcpEnabled(next: boolean) {
            enabled = next;
            return this.getConfig();
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
            return {
              version: 1,
              sources,
              mcp: { enabled: true },
              ui: { mode: "safe" as const },
              indexing: { watch: { enabled: true } },
              embedding: {
                provider: "local" as const,
                endpoint: "",
                apiKeys: {},
                dimension: 384,
              },
              modelHub: { hfEndpoint: "https://hf-mirror.com" },
              reranker: { mode: "local" as const, model: "BAAI/bge-reranker-base", topN: 5 },
            };
          },
          getSources() {
            return sources;
          },
          addSource(path: string) {
            if (!sources.find((item) => item.path === path)) {
              sources = [...sources, { path, enabled: true }];
            }
            return sources;
          },
          updateSource(path: string, enabled: boolean) {
            sources = sources.map((item) => (item.path === path ? { ...item, enabled } : item));
            return sources;
          },
          removeSource(path: string) {
            sources = sources.filter((item) => item.path !== path);
            return sources;
          },
        })}
      />,
    );
    const root = renderer.root;

    expect(root.findByProps({ children: "/notes" })).toBeDefined();
    expect(root.findByProps({ children: "/archive" })).toBeDefined();

    const archiveToggle = root.findByProps({ "data-testid": "toggle-/archive" });
    act(() => {
      archiveToggle.props.onChange({ target: { checked: true } });
    });
    expect(sources.find((item) => item.path === "/archive")?.enabled).toBe(true);

    const addButton = root.findByProps({ "data-testid": "add-source" });
    await act(async () => {
      await addButton.props.onClick();
    });
    expect(sources.find((item) => item.path === "/docs")).toBeDefined();
    expect(root.findByProps({ children: "Source added. Indexing started." })).toBeDefined();

    const removeButton = root.findByProps({ "data-testid": "remove-/notes" });
    act(() => {
      removeButton.props.onClick();
    });
    expect(sources.find((item) => item.path === "/notes")).toBeUndefined();
  });

  it("saves embedding and reranker settings", () => {
    let embeddingProvider: "local" | "qwen_dense" | "qwen_sparse" | "openai_dense" = "local";
    let embeddingApiKeyMap: Record<string, string> = {};
    let hfEndpoint = "https://hf-mirror.com";
    let rerankerMode: "none" | "local" = "local";
    const renderer = create(
      <SettingsPage
        pickSourceDirectory={async () => null}
        configService={makeConfigService({
          updateEmbedding(input) {
            embeddingProvider = (input.provider as typeof embeddingProvider) ?? embeddingProvider;
            embeddingApiKeyMap = { ...embeddingApiKeyMap, ...(input.apiKeys ?? {}) };
            return this.getConfig();
          },
          updateModelHub(input) {
            hfEndpoint = input.hfEndpoint ?? hfEndpoint;
            return this.getConfig();
          },
          updateReranker(input) {
            rerankerMode = (input.mode as "none" | "local") ?? rerankerMode;
            return this.getConfig();
          },
        })}
      />,
    );
    const root = renderer.root;

    const providerSelect = root.findByProps({ "data-testid": "embedding-provider" });
    const apiKeyInput = root.findByProps({ "data-testid": "embedding-api-key" });
    act(() => {
      providerSelect.props.onChange({ target: { value: "openai_dense" } });
    });
    act(() => {
      apiKeyInput.props.onChange({ target: { value: "sk-live-1" } });
    });
    const saveEmbedding = root.findByProps({ "data-testid": "save-embedding" });
    act(() => {
      saveEmbedding.props.onClick();
    });
    const hfInput = root.findByProps({ "data-testid": "hf-endpoint" });
    act(() => {
      hfInput.props.onChange({ target: { value: "https://hf.example.com" } });
    });
    const saveModelHub = root.findByProps({ "data-testid": "save-model-hub" });
    act(() => {
      saveModelHub.props.onClick();
    });

    const rerankerModeSelect = root.findByProps({ "data-testid": "reranker-mode" });
    act(() => {
      rerankerModeSelect.props.onChange({ target: { value: "none" } });
    });
    const saveReranker = root.findByProps({ "data-testid": "save-reranker" });
    act(() => {
      saveReranker.props.onClick();
    });

    expect(embeddingProvider).toBe("openai_dense");
    expect(embeddingApiKeyMap.openai_dense).toBe("sk-live-1");
    expect(hfEndpoint).toBe("https://hf.example.com");
    expect(rerankerMode).toBe("none");
  });
});
