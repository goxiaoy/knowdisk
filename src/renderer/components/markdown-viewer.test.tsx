import { afterEach, expect, mock, test } from "bun:test";
import { createContext, useContext, useLayoutEffect, type ReactNode } from "react";
import renderer, { act } from "react-test-renderer";

const originalWindow = globalThis.window;
let editorLoading = false;

const editorContext = createContext<{
  setEditorFactory?: (factory: () => unknown) => void;
  loading: boolean;
}>({
  loading: false,
});

mock.module("@milkdown/react", () => ({
  Milkdown: () => <div data-testid="mock-milkdown-root" />,
  MilkdownProvider: ({ children }: { children: ReactNode }) => {
    return (
      <editorContext.Provider
        value={{
          loading: editorLoading,
          setEditorFactory: () => {},
        }}
      >
        <div data-testid="provider-ready">{children}</div>
      </editorContext.Provider>
    );
  },
  useEditor: (getEditor: (root: HTMLElement) => unknown) => {
    const editorInfo = useContext(editorContext);
    useLayoutEffect(() => {
      if (!editorInfo.setEditorFactory) {
        throw new TypeError("editorInfo.setEditorFactory is not a function");
      }
      editorInfo.setEditorFactory(() => () => getEditor({} as HTMLElement));
    }, [editorInfo, getEditor]);
    return {
      loading: editorInfo.loading,
      get: () => null,
    };
  },
}));

mock.module("@milkdown/kit/core", () => ({
  Editor: {
    make: () => ({
      config() {
        return this;
      },
      use() {
        return this;
      },
      create: async () => ({}),
      destroy: async () => {},
    }),
  },
  rootCtx: Symbol("rootCtx"),
  defaultValueCtx: Symbol("defaultValueCtx"),
  editorViewOptionsCtx: Symbol("editorViewOptionsCtx"),
}));

mock.module("@milkdown/kit/preset/commonmark", () => ({
  commonmark: {},
}));

mock.module("@milkdown/theme-nord", () => ({
  nord: {},
}));

afterEach(() => {
  editorLoading = false;
  if (originalWindow === undefined) {
    delete (globalThis as typeof globalThis & { window?: Window }).window;
    return;
  }
  globalThis.window = originalWindow;
});

test("wraps milkdown editor hooks with MilkdownProvider", async () => {
  globalThis.window = {} as Window;

  const { MarkdownViewer } = await import("./markdown-viewer");
  let tree: renderer.ReactTestRenderer | null = null;

  await act(async () => {
    tree = renderer.create(<MarkdownViewer markdown="# hello" />);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(tree).toBeTruthy();
  expect(tree!.root.findByProps({ "data-testid": "provider-ready" })).toBeTruthy();
});

test("keeps Milkdown mounted while showing loading state", async () => {
  globalThis.window = {} as Window;
  editorLoading = true;

  const { MarkdownViewer } = await import("./markdown-viewer");
  let tree: renderer.ReactTestRenderer | null = null;

  await act(async () => {
    tree = renderer.create(<MarkdownViewer markdown="# hello" />);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(tree).toBeTruthy();
  expect(tree!.root.findByProps({ "data-testid": "mock-milkdown-root" })).toBeTruthy();
  expect(
    tree!.root.findAll(
      (node) =>
        node.children.length === 1 &&
        typeof node.children[0] === "string" &&
        node.children[0] === "Rendering markdown..."
    ).length
  ).toBeGreaterThan(0);
});
