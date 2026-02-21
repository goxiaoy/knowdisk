import { describe, expect, it } from "bun:test";
import { act, create } from "react-test-renderer";
import { SettingsPage } from "./SettingsPage";

describe("SettingsPage", () => {
  it("hides advanced section by default", () => {
    const renderer = create(
      <SettingsPage
        configService={{
          getConfig() {
            throw new Error("unused");
          },
          getMcpEnabled() {
            return true;
          },
          setMcpEnabled() {
            throw new Error("unused");
          },
          getSources() {
            return [];
          },
          addSource() {
            throw new Error("unused");
          },
          updateSource() {
            throw new Error("unused");
          },
          removeSource() {
            throw new Error("unused");
          },
        }}
      />,
    );
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
        configService={{
          getConfig() {
            throw new Error("unused");
          },
          getMcpEnabled() {
            return enabled;
          },
          setMcpEnabled(next: boolean) {
            enabled = next;
            return {
              version: 1,
              sources: [],
              mcp: { enabled: next },
              ui: { mode: "safe" as const },
              indexing: { watch: { enabled: true } },
              embedding: { mode: "local" as const, model: "bge-small", endpoint: "" },
            };
          },
          getSources() {
            return [];
          },
          addSource() {
            throw new Error("unused");
          },
          updateSource() {
            throw new Error("unused");
          },
          removeSource() {
            throw new Error("unused");
          },
        }}
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

  it("shows and edits sources", () => {
    let sources = [
      { path: "/notes", enabled: true },
      { path: "/archive", enabled: false },
    ];
    const renderer = create(
      <SettingsPage
        configService={{
          getConfig() {
            throw new Error("unused");
          },
          getMcpEnabled() {
            return true;
          },
          setMcpEnabled() {
            throw new Error("unused");
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
        }}
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

    const input = root.findByProps({ "data-testid": "source-input" });
    act(() => {
      input.props.onChange({ target: { value: "/docs" } });
    });
    const addButton = root.findByProps({ "data-testid": "add-source" });
    act(() => {
      addButton.props.onClick();
    });
    expect(sources.find((item) => item.path === "/docs")).toBeDefined();

    const removeButton = root.findByProps({ "data-testid": "remove-/notes" });
    act(() => {
      removeButton.props.onClick();
    });
    expect(sources.find((item) => item.path === "/notes")).toBeUndefined();
  });
});
