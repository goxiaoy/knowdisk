import { expect, mock, test } from "bun:test";
import renderer, { act } from "react-test-renderer";
import { ChatPanel } from "./chat-panel";

function createSearchApi() {
  return {
    search: mock(async ({ query }: { query: string; titleOnly?: boolean }) => ({
      ok: true as const,
      query,
      titleOnly: false as const,
      finalResults: !query
        ? [
            { nodeId: "node-1", title: "Alpha.md", text: "docs/alpha.md" },
            { nodeId: "node-2", title: "Beta.md", text: "docs/beta.md" },
          ]
        : [{ nodeId: "node-3", title: "Gamma.md", text: "docs/gamma.md" }],
    })),
    getFileMarkdown: mock(async () => ({ ok: true as const, markdown: "", title: null })),
  };
}

test("opens picker and loads recent files on add item", async () => {
  const searchApi = createSearchApi();
  const tree = renderer.create(<ChatPanel searchApi={searchApi} debounceMs={0} />);
  const addButton = tree.root.findByProps({ "data-testid": "chat-add-item-button" });

  await act(async () => {
    addButton.props.onClick();
    await Promise.resolve();
  });

  expect(searchApi.search).toHaveBeenCalledWith({ query: "", titleOnly: false });
  expect(tree.root.findByProps({ "data-testid": "chat-item-picker" })).toBeTruthy();
  expect(tree.root.findAllByProps({ "data-testid": "chat-picker-result" }).length).toBe(2);
});

test("supports selecting multiple files and deduplicates by node id", async () => {
  const searchApi = createSearchApi();
  const tree = renderer.create(<ChatPanel searchApi={searchApi} debounceMs={0} />);
  const addButton = tree.root.findByProps({ "data-testid": "chat-add-item-button" });

  await act(async () => {
    addButton.props.onClick();
    await Promise.resolve();
  });

  const results = tree.root.findAllByProps({ "data-testid": "chat-picker-result" });

  await act(async () => {
    results[0]!.props.onClick();
    results[1]!.props.onClick();
    results[0]!.props.onClick();
    await Promise.resolve();
  });

  const chips = tree.root.findAllByProps({ "data-testid": "chat-selected-chip" });
  expect(chips.length).toBe(2);
  expect(tree.root.findAll((node) => node.children?.includes?.("Alpha.md")).length).toBeGreaterThan(0);
  expect(tree.root.findAll((node) => node.children?.includes?.("Beta.md")).length).toBeGreaterThan(0);
});

test("removes a selected file chip", async () => {
  const searchApi = createSearchApi();
  const tree = renderer.create(<ChatPanel searchApi={searchApi} debounceMs={0} />);
  const addButton = tree.root.findByProps({ "data-testid": "chat-add-item-button" });

  await act(async () => {
    addButton.props.onClick();
    await Promise.resolve();
  });

  const result = tree.root.findAllByProps({ "data-testid": "chat-picker-result" })[0]!;

  await act(async () => {
    result.props.onClick();
    await Promise.resolve();
  });

  const removeButton = tree.root.findByProps({ "data-testid": "chat-selected-chip-remove" });

  await act(async () => {
    removeButton.props.onClick();
    await Promise.resolve();
  });

  expect(tree.root.findAllByProps({ "data-testid": "chat-selected-chip" }).length).toBe(0);
});
