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

  it("configures claude mcp and shows config path", async () => {
    let called = 0;
    const renderer = create(
      <HomePage
        installClaudeMcp={async () => {
          called += 1;
          return {
            ok: true,
            path: "/Users/goxy/Library/Application Support/Claude/claude_desktop_config.json",
          };
        }}
      />,
    );

    const button = renderer.root.findByProps({ "data-testid": "home-configure-claude-mcp" });
    await act(async () => {
      await button.props.onClick();
    });

    expect(called).toBe(1);
    expect(
      renderer.root.findByProps({
        children:
          "Claude MCP configured: /Users/goxy/Library/Application Support/Claude/claude_desktop_config.json",
      }),
    ).toBeDefined();
  });

  it("streams chat response and shows assistant text", async () => {
    let latest: Array<{
      id: string;
      sessionId: string;
      role: "assistant" | "user";
      content: string;
      status: "done";
      createdAt: number;
      citations?: [];
    }> = [];
    const renderer = create(
      <HomePage
        hasChatApiKey
        listSessions={async () => [{ id: "s1", title: "New Chat", createdAt: 1, updatedAt: 1, lastMessageAt: 1 }]}
        listMessages={async () => latest}
        startChat={async ({ onChunk }) => {
          onChunk("hello ");
          onChunk("world");
          latest = [
            {
              id: "m1",
              sessionId: "s1",
              role: "assistant",
              content: "hello world",
              status: "done",
              createdAt: Date.now(),
              citations: [],
            },
          ];
          return {
            requestId: "r1",
            done: Promise.resolve({
              message: latest[0]!,
              citations: [],
            }),
          };
        }}
      />,
    );

    const composer = renderer.root.findByProps({ "data-testid": "chat-composer" });
    await act(async () => {
      composer.props.onChange({ target: { value: "hi" } });
    });
    const send = renderer.root.findByProps({ "data-testid": "chat-send" });
    await act(async () => {
      await send.props.onClick();
    });

    expect(
      renderer.root
        .findAllByType("p")
        .some((item) => item.children.map((child) => String(child)).join("").includes("hello world")),
    ).toBe(true);
  });
});
