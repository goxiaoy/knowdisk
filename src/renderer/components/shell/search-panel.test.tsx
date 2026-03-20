import { expect, mock, test } from "bun:test";
import renderer, { act } from "react-test-renderer";
import { SearchPanel } from "./search-panel";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createApi() {
  return {
    search: mock(async ({ query }: { query: string; titleOnly?: boolean }) => ({
      ok: true as const,
      query,
      titleOnly: false as const,
      finalResults: [
        {
          nodeId: "node-1",
          name: "alpha.md",
          title: "Alpha",
          text: "Alpha snippet",
          sourceRef: "alpha.md",
        },
        {
          nodeId: "node-2",
          name: "beta.md",
          title: "Beta",
          text: "Beta snippet",
          sourceRef: "beta.md",
        },
      ],
    })),
    getFileMarkdown: mock(async (nodeId: string) => ({
      ok: true as const,
      markdown: nodeId === "node-1" ? "# Alpha Preview" : "# Beta Preview",
      title: nodeId === "node-1" ? "Alpha" : "Beta",
    })),
  };
}

test("loads recent files before any query", async () => {
  const api = {
    search: mock(async ({ query }: { query: string; titleOnly?: boolean }) => ({
      ok: true as const,
      query,
      titleOnly: false as const,
      finalResults: [
        {
          nodeId: "node-recent",
          name: "recent.md",
          title: "recent.md",
          text: "docs/recent.md",
          sourceRef: "docs/recent.md",
        },
      ],
    })),
    getFileMarkdown: mock(async () => ({
      ok: true as const,
      markdown: "# Recent Preview",
      title: "recent.md",
    })),
  };
  const tree = renderer.create(<SearchPanel api={api} debounceMs={0} />);

  await act(async () => {
    await Promise.resolve();
  });

  expect(tree.root.findByProps({ "data-testid": "search-panel" })).toBeTruthy();
  expect(String(tree.root.findByProps({ "data-testid": "search-panel" }).props.className)).toContain(
    "overflow-hidden"
  );
  expect(
    String(tree.root.findByProps({ "data-testid": "search-results-pane" }).props.className)
  ).toContain("overflow-auto");
  expect(
    String(tree.root.findByProps({ "data-testid": "search-preview" }).props.className)
  ).toContain("overflow-auto");
  expect(api.search).toHaveBeenCalledTimes(1);
  expect(api.search).toHaveBeenCalledWith({ query: "", titleOnly: false });
  expect(tree.root.findAllByProps({ "data-testid": "search-result-card" }).length).toBe(1);
});

test("searches, renders results, and loads preview for the first result", async () => {
  const api = createApi();
  const tree = renderer.create(<SearchPanel api={api} debounceMs={0} />);
  const input = tree.root.findByProps({ id: "search-query" });

  await act(async () => {
    input.props.onChange({ target: { value: "alpha" } });
    await Promise.resolve();
  });

  expect(api.search).toHaveBeenCalledTimes(2);
  expect(api.search).toHaveBeenCalledWith({ query: "alpha", titleOnly: false });
  expect(api.getFileMarkdown).toHaveBeenCalledTimes(1);
  expect(api.getFileMarkdown).toHaveBeenCalledWith("node-1");
  expect(tree.root.findAllByProps({ "data-testid": "search-result-card" }).length).toBe(2);
  expect(tree.root.findByProps({ "data-testid": "search-preview" })).toBeTruthy();
  expect(tree.root.findAll((node) => node.children?.includes?.("Alpha snippet")).length).toBeGreaterThan(0);
  expect(tree.root.findAll((node) => node.children?.includes?.("Alpha")).length).toBeGreaterThan(0);
});

test("selecting another result loads its preview", async () => {
  const api = createApi();
  const tree = renderer.create(<SearchPanel api={api} debounceMs={0} />);
  const input = tree.root.findByProps({ id: "search-query" });

  await act(async () => {
    input.props.onChange({ target: { value: "alpha" } });
    await Promise.resolve();
  });

  const cards = tree.root.findAllByProps({ "data-testid": "search-result-card" });

  await act(async () => {
    cards[1]!.props.onClick();
    await Promise.resolve();
  });

  expect(api.getFileMarkdown).toHaveBeenCalledWith("node-2");
});

test("ignores stale search responses for an older query", async () => {
  const first = deferred<{
    ok: true;
    query: string;
    titleOnly: false;
    finalResults: Array<{ nodeId: string; title: string; text: string }>;
  }>();
  const second = deferred<{
    ok: true;
    query: string;
    titleOnly: false;
    finalResults: Array<{ nodeId: string; title: string; text: string }>;
  }>();
  const api = {
    search: mock(async ({ query }: { query: string; titleOnly?: boolean }) => {
      return query === "alpha" ? await first.promise : await second.promise;
    }),
    getFileMarkdown: mock(async (nodeId: string) => ({
      ok: true as const,
      markdown: `# ${nodeId}`,
      title: nodeId,
    })),
  };
  const tree = renderer.create(<SearchPanel api={api} debounceMs={0} />);
  const input = tree.root.findByProps({ id: "search-query" });

  await act(async () => {
    input.props.onChange({ target: { value: "alpha" } });
    input.props.onChange({ target: { value: "beta" } });
    await Promise.resolve();
  });

  await act(async () => {
    second.resolve({
      ok: true,
      query: "beta",
      titleOnly: false,
      finalResults: [{ nodeId: "node-beta", title: "Beta", text: "Beta result" }],
    });
    await Promise.resolve();
  });

  await act(async () => {
    first.resolve({
      ok: true,
      query: "alpha",
      titleOnly: false,
      finalResults: [{ nodeId: "node-alpha", title: "Alpha", text: "Alpha result" }],
    });
    await Promise.resolve();
  });

  expect(tree.root.findAll((node) => node.children?.includes?.("Beta result")).length).toBeGreaterThan(0);
  expect(tree.root.findAll((node) => node.children?.includes?.("Alpha result")).length).toBe(0);
});

test("renders preview error state when markdown loading fails", async () => {
  const api = {
    search: mock(async ({ query }: { query: string; titleOnly?: boolean }) => ({
      ok: true as const,
      query,
      titleOnly: false as const,
      finalResults: [{ nodeId: "node-1", title: "Alpha", text: "Alpha snippet" }],
    })),
    getFileMarkdown: mock(async () => ({ ok: false as const, error: "preview unavailable" })),
  };
  const tree = renderer.create(<SearchPanel api={api} debounceMs={0} />);
  const input = tree.root.findByProps({ id: "search-query" });

  await act(async () => {
    input.props.onChange({ target: { value: "alpha" } });
    await Promise.resolve();
  });

  expect(tree.root.findByProps({ "data-testid": "search-preview-error-state" })).toBeTruthy();
});

test("clearing the query reloads recent files", async () => {
  const api = {
    search: mock(async ({ query }: { query: string; titleOnly?: boolean }) => {
      if (!query) {
        return {
          ok: true as const,
          query,
          titleOnly: false as const,
          finalResults: [{ nodeId: "node-recent", title: "Recent", text: "Recent file" }],
        };
      }
      return {
        ok: true as const,
        query,
        titleOnly: false as const,
        finalResults: [{ nodeId: "node-alpha", title: "Alpha", text: "Alpha result" }],
      };
    }),
    getFileMarkdown: mock(async (nodeId: string) => ({
      ok: true as const,
      markdown: `# ${nodeId}`,
      title: nodeId,
    })),
  };
  const tree = renderer.create(<SearchPanel api={api} debounceMs={0} />);
  const input = tree.root.findByProps({ id: "search-query" });

  await act(async () => {
    input.props.onChange({ target: { value: "alpha" } });
    await Promise.resolve();
  });

  await act(async () => {
    input.props.onChange({ target: { value: "" } });
    await Promise.resolve();
  });

  expect(api.search).toHaveBeenCalledWith({ query: "", titleOnly: false });
  expect(tree.root.findAll((node) => node.children?.includes?.("Recent file")).length).toBeGreaterThan(0);
});
