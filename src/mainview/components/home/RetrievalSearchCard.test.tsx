import { describe, expect, it } from "bun:test";
import { act, create } from "react-test-renderer";
import { RetrievalSearchCard } from "./RetrievalSearchCard";

describe("RetrievalSearchCard", () => {
  it("calls search with topK=10 and renders card fields", async () => {
    const calls: Array<{ query: string; topK: number }> = [];
    const renderer = create(
      <RetrievalSearchCard
        search={async (query, topK) => {
          calls.push({ query, topK });
          return [
            {
              chunkId: "c1",
              sourcePath: "/docs/a.md",
              chunkText: "hello world",
              score: 0.9876,
            },
          ];
        }}
      />,
    );

    const root = renderer.root;
    await act(async () => {
      root.findByProps({ "data-testid": "retrieval-query" }).props.onChange({ target: { value: "what is knowdisk" } });
    });

    await act(async () => {
      await root.findByProps({ "data-testid": "retrieval-search" }).props.onClick();
    });

    expect(calls).toEqual([{ query: "what is knowdisk", topK: 10 }]);
    expect(root.findByProps({ children: "/docs/a.md" })).toBeDefined();
    const scoreTextExists = root
      .findAllByType("p")
      .some((item) => item.children.map((child) => String(child)).join("").includes("score: 0.988"));
    expect(scoreTextExists).toBe(true);
    expect(root.findByProps({ children: "hello world" })).toBeDefined();
  });

  it("shows error when search request fails", async () => {
    const renderer = create(
      <RetrievalSearchCard
        search={async () => null}
      />,
    );

    const root = renderer.root;
    await act(async () => {
      root.findByProps({ "data-testid": "retrieval-query" }).props.onChange({ target: { value: "abc" } });
    });

    await act(async () => {
      await root.findByProps({ "data-testid": "retrieval-search" }).props.onClick();
    });

    expect(root.findByProps({ "data-testid": "retrieval-error" })).toBeDefined();
  });

  it("disables search button for empty query", () => {
    const renderer = create(<RetrievalSearchCard search={async () => []} />);
    const button = renderer.root.findByProps({ "data-testid": "retrieval-search" });
    expect(button.props.disabled).toBe(true);
  });
});
