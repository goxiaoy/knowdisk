import { describe, expect, it } from "bun:test";
import { act, create } from "react-test-renderer";
import { HomePage } from "./HomePage";

describe("HomePage", () => {
  it("triggers force resync and shows success activity", async () => {
    let called = 0;
    const renderer = create(
      <HomePage
        forceResync={async () => {
          called += 1;
          return { ok: true };
        }}
      />,
    );

    const button = renderer.root.findByProps({ "data-testid": "home-force-resync" });
    await act(async () => {
      await button.props.onClick();
    });

    expect(called).toBe(1);
    expect(renderer.root.findByProps({ children: "Force resync started." })).toBeDefined();
  });

  it("shows failure activity when force resync fails", async () => {
    const renderer = create(
      <HomePage
        forceResync={async () => ({ ok: false, error: "boom" })}
      />,
    );

    const button = renderer.root.findByProps({ "data-testid": "home-force-resync" });
    await act(async () => {
      await button.props.onClick();
    });

    expect(renderer.root.findByProps({ children: "Force resync failed: boom" })).toBeDefined();
  });
});
