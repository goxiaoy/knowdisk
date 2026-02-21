import { describe, expect, it } from "bun:test";
import { act, create } from "react-test-renderer";
import { SettingsPage } from "./SettingsPage";
import type { ConfigService } from "../../../core/config/config.types";

function makeConfigService(overrides?: Partial<ConfigService>): ConfigService {
  let enabled = true;
  let sources: Array<{ path: string; enabled: boolean }> = [];
  let embedding = {
    provider: "local" as const,
    local: {
      hfEndpoint: "https://hf-mirror.com",
      cacheDir: "build/cache/embedding/local",
      model: "Xenova/all-MiniLM-L6-v2",
      dimension: 384,
    },
    qwen_dense: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
    qwen_sparse: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
    openai_dense: { apiKey: "", model: "text-embedding-3-small", dimension: 1536 },
  };
  let reranker = {
    enabled: true,
    provider: "local" as const,
    local: {
      hfEndpoint: "https://hf-mirror.com",
      cacheDir: "build/cache/reranker/local",
      model: "BAAI/bge-reranker-base",
      topN: 5,
    },
    qwen: { apiKey: "", model: "gte-rerank-v2", topN: 5 },
    openai: { apiKey: "", model: "text-embedding-3-small", topN: 5 },
  };

  const base: ConfigService = {
    getConfig() {
      return {
        version: 1,
        sources,
        mcp: { enabled },
        ui: { mode: "safe" as const },
        indexing: { watch: { enabled: true } },
        embedding,
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
        local: { ...embedding.local, ...(input.local ?? {}) },
        qwen_dense: { ...embedding.qwen_dense, ...(input.qwen_dense ?? {}) },
        qwen_sparse: { ...embedding.qwen_sparse, ...(input.qwen_sparse ?? {}) },
        openai_dense: { ...embedding.openai_dense, ...(input.openai_dense ?? {}) },
      };
      return this.getConfig();
    },
    updateReranker(input) {
      reranker = {
        ...reranker,
        ...input,
        local: { ...reranker.local, ...(input.local ?? {}) },
        qwen: { ...reranker.qwen, ...(input.qwen ?? {}) },
        openai: { ...reranker.openai, ...(input.openai ?? {}) },
      };
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
              ...makeConfigService().getConfig(),
              sources,
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
    let embeddingApiKey = "";
    let rerankerProvider: "local" | "qwen" | "openai" = "local";
    let rerankerApiKey = "";
    const renderer = create(
      <SettingsPage
        pickSourceDirectory={async () => null}
        configService={makeConfigService({
          updateEmbedding(input) {
            embeddingProvider = (input.provider as typeof embeddingProvider) ?? embeddingProvider;
            if (input.openai_dense?.apiKey) {
              embeddingApiKey = input.openai_dense.apiKey;
            }
            return this.getConfig();
          },
          updateReranker(input) {
            rerankerProvider = (input.provider as typeof rerankerProvider) ?? rerankerProvider;
            if (input.openai?.apiKey) {
              rerankerApiKey = input.openai.apiKey;
            }
            return this.getConfig();
          },
        })}
      />, 
    );
    const root = renderer.root;

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

    expect(embeddingProvider).toBe("openai_dense");
    expect(embeddingApiKey).toBe("sk-live-1");
    expect(rerankerProvider).toBe("openai");
    expect(rerankerApiKey).toBe("rk-live-1");
  });
});
