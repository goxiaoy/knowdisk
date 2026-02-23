import { describe, expect, it } from "bun:test";
import { act, create } from "react-test-renderer";
import { RetrievalSearchCard } from "./RetrievalSearchCard";

describe("RetrievalSearchCard", () => {
  it("calls search with topK=10 and renders card fields", async () => {
    const calls: Array<{ query: string; topK: number; titleOnly?: boolean }> = [];
    const renderer = create(
      <RetrievalSearchCard
        search={async (query, topK, titleOnly) => {
          calls.push({ query, topK, titleOnly });
          return {
          reranked: [
            {
              chunkId: "c1",
              sourcePath: "/docs/a.md",
              chunkText: "hello world",
              score: 0.9876,
            },
          ],
          fts: [
            {
              chunkId: "c1",
              sourcePath: "/docs/a.md",
              score: 0.1,
              kind: "content",
              text: "hello world",
            },
          ],
          vector: [
            {
              chunkId: "c1",
              sourcePath: "/docs/a.md",
              chunkText: "hello world",
              score: 0.9,
            },
          ],
          };
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

    expect(calls).toEqual([{ query: "what is knowdisk", topK: 10, titleOnly: false }]);
    expect(root.findAllByProps({ children: "/docs/a.md" }).length).toBeGreaterThan(0);
    expect(root.findByProps({ children: "Rerank Results (1)" })).toBeDefined();
    expect(root.findByProps({ children: "FTS Results (1)" })).toBeDefined();
    expect(root.findByProps({ children: "Vector Results (1)" })).toBeDefined();
    const scoreTextExists = root
      .findAllByType("p")
      .some((item) => item.children.map((child) => String(child)).join("").includes("score: 0.988"));
    expect(scoreTextExists).toBe(true);
    expect(root.findAllByProps({ children: "hello world" }).length).toBeGreaterThan(0);
  });

  it("passes titleOnly=true when toggle is enabled", async () => {
    const calls: Array<{ query: string; topK: number; titleOnly?: boolean }> = [];
    const renderer = create(
      <RetrievalSearchCard
        search={async (query, topK, titleOnly) => {
          calls.push({ query, topK, titleOnly });
          return { reranked: [], fts: [], vector: [] };
        }}
      />,
    );

    const root = renderer.root;
    await act(async () => {
      root.findByProps({ "data-testid": "retrieval-query" }).props.onChange({ target: { value: "readme" } });
      root.findByProps({ "data-testid": "retrieval-title-only" }).props.onChange({ target: { checked: true } });
    });

    await act(async () => {
      await root.findByProps({ "data-testid": "retrieval-search" }).props.onClick();
    });

    expect(calls).toEqual([{ query: "readme", topK: 10, titleOnly: true }]);
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
    const renderer = create(
      <RetrievalSearchCard
        search={async () => ({ reranked: [], fts: [], vector: [] })}
      />,
    );
    const button = renderer.root.findByProps({ "data-testid": "retrieval-search" });
    expect(button.props.disabled).toBe(true);
  });

  it("retrieves all chunks by source path", async () => {
    const calls: string[] = [];
    const renderer = create(
      <RetrievalSearchCard
        search={async () => ({ reranked: [], fts: [], vector: [] })}
        retrieveBySourcePath={async (sourcePath) => {
          calls.push(sourcePath);
          return [
            {
              chunkId: "c1",
              sourcePath,
              chunkText: "chunk from file",
              score: 0,
              startOffset: 0,
              endOffset: 20,
              tokenEstimate: 8,
            },
          ];
        }}
      />,
    );

    const root = renderer.root;
    await act(async () => {
      root.findByProps({ "data-testid": "retrieval-source-path" }).props.onChange({ target: { value: "/docs/a.md" } });
    });

    await act(async () => {
      await root.findByProps({ "data-testid": "retrieval-by-source" }).props.onClick();
    });

    expect(calls).toEqual(["/docs/a.md"]);
    expect(root.findByProps({ children: "/docs/a.md" })).toBeDefined();
    expect(root.findByProps({ children: "chunk from file" })).toBeDefined();
  });

  it("fills source path from file picker", async () => {
    const renderer = create(
      <RetrievalSearchCard
        search={async () => ({ reranked: [], fts: [], vector: [] })}
        retrieveBySourcePath={async () => []}
        listSourceFiles={async () => []}
        pickFilePath={async () => "/picked/path/readme.md"}
      />,
    );
    const root = renderer.root;

    await act(async () => {
      await root.findByProps({ "data-testid": "retrieval-pick-file" }).props.onClick();
    });

    const input = root.findByProps({ "data-testid": "retrieval-source-path" });
    expect(input.props.value).toBe("/picked/path/readme.md");
  });

  it("loads source file options for autocomplete", async () => {
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <RetrievalSearchCard
          search={async () => ({ reranked: [], fts: [], vector: [] })}
          retrieveBySourcePath={async () => []}
          listSourceFiles={async () => ["/docs/a.md", "/docs/b.md"]}
          pickFilePath={async () => null}
        />,
      );
      await Promise.resolve();
    });

    const root = renderer!.root;
    const options = root.findAllByType("option").map((node) => node.props.value);
    expect(options).toEqual(["/docs/a.md", "/docs/b.md"]);
  });
});
