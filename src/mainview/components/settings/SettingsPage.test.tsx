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
});
