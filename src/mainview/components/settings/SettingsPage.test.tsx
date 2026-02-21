import { describe, expect, it } from "bun:test";
import { act, create } from "react-test-renderer";
import { SettingsPage } from "./SettingsPage";

describe("SettingsPage", () => {
  it("hides advanced section by default", () => {
    const renderer = create(<SettingsPage />);
    const root = renderer.root;

    expect(() => root.findByProps({ children: "Advanced Settings" })).toThrow();

    const button = root.findByType("button");
    act(() => {
      button.props.onClick();
    });

    expect(root.findByProps({ children: "Advanced Settings" })).toBeDefined();
  });
});
