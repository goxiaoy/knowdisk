import { afterEach, expect, mock, test } from "bun:test";
import renderer, { act } from "react-test-renderer";

const originalWindow = globalThis.window;

const crepeCalls: Array<{
  options: Record<string, unknown>;
  setReadonlyValues: boolean[];
  createCalls: number;
  destroyCalls: number;
}> = [];

mock.module("@milkdown/crepe", () => ({
  Crepe: class MockCrepe {
    static Feature = {
      BlockEdit: "block-edit",
      Cursor: "cursor",
      ImageBlock: "image-block",
      LinkTooltip: "link-tooltip",
      Placeholder: "placeholder",
      Toolbar: "toolbar",
    };

    private readonly call;

    constructor(options: Record<string, unknown>) {
      this.call = {
        options,
        setReadonlyValues: [],
        createCalls: 0,
        destroyCalls: 0,
      };
      crepeCalls.push(this.call);
    }

    setReadonly(value: boolean) {
      this.call.setReadonlyValues.push(value);
      return this;
    }

    async create() {
      this.call.createCalls += 1;
      return {};
    }

    async destroy() {
      this.call.destroyCalls += 1;
      return {};
    }
  },
}));

afterEach(() => {
  crepeCalls.length = 0;
  if (originalWindow === undefined) {
    delete (globalThis as typeof globalThis & { window?: Window }).window;
    return;
  }
  globalThis.window = originalWindow;
});

const createNodeMock: renderer.TestRendererOptions["createNodeMock"] = (element) => {
  if (element.props["data-testid"] === "markdown-crepe-root") {
    return { innerHTML: "" };
  }
  return null;
};

test("renders plain fallback when window is unavailable", async () => {
  delete (globalThis as typeof globalThis & { window?: Window }).window;

  const { MarkdownViewer } = await import("./markdown-viewer");

  const tree = renderer.create(<MarkdownViewer markdown={"# hello\n\n```text\nworld\n```"} />);

  expect(tree.root.findByType("article")).toBeTruthy();
  expect(crepeCalls).toHaveLength(0);
});

test("creates a read-only crepe instance in browser mode", async () => {
  globalThis.window = {} as Window;

  const { MarkdownViewer } = await import("./markdown-viewer");
  let tree: renderer.ReactTestRenderer | null = null;

  await act(async () => {
    tree = renderer.create(<MarkdownViewer markdown="# hello" />, { createNodeMock });
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(tree).toBeTruthy();
  expect(tree!.root.findByProps({ "data-testid": "markdown-crepe-root" })).toBeTruthy();
  expect(crepeCalls).toHaveLength(1);
  expect(crepeCalls[0]?.options.defaultValue).toBe("# hello");
  expect(crepeCalls[0]?.setReadonlyValues).toEqual([true]);
  expect(crepeCalls[0]?.createCalls).toBe(1);
});

test("destroys the crepe instance on unmount", async () => {
  globalThis.window = {} as Window;

  const { MarkdownViewer } = await import("./markdown-viewer");
  let tree: renderer.ReactTestRenderer | null = null;

  await act(async () => {
    tree = renderer.create(<MarkdownViewer markdown="# hello" />, { createNodeMock });
    await Promise.resolve();
    await Promise.resolve();
  });

  await act(async () => {
    tree!.unmount();
    await Promise.resolve();
  });

  expect(crepeCalls).toHaveLength(1);
  expect(crepeCalls[0]?.destroyCalls).toBe(1);
});
