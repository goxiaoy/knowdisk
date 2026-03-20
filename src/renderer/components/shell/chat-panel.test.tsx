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

test("keeps a single selected file and replaces it when picking another result", async () => {
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
    await Promise.resolve();
  });

  const chips = tree.root.findAllByProps({ "data-testid": "chat-selected-chip" });
  expect(chips.length).toBe(1);
  expect(chips[0]!.findAll((node) => node.children?.includes?.("Alpha.md")).length).toBe(0);
  expect(chips[0]!.findAll((node) => node.children?.includes?.("Beta.md")).length).toBeGreaterThan(0);
});

test("moves add item button after the selected chip", async () => {
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

  const row = tree.root.findByProps({ "data-testid": "chat-selected-row" });
  const selectedChipIndex = row.children.findIndex(
    (child: unknown) =>
      typeof child === "object" &&
      child !== null &&
      "props" in child &&
      (child as { props?: { "data-testid"?: string } }).props?.["data-testid"] === "chat-selected-chip"
  );
  const addButtonIndex = row.children.findIndex(
    (child: unknown) =>
      typeof child === "object" &&
      child !== null &&
      "props" in child &&
      (child as { props?: { "data-testid"?: string } }).props?.["data-testid"] === "chat-add-item-button"
  );

  expect(selectedChipIndex).toBeGreaterThanOrEqual(0);
  expect(addButtonIndex).toBeGreaterThan(selectedChipIndex);
});

test("closes the picker after selecting a file", async () => {
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

  expect(tree.root.findAllByProps({ "data-testid": "chat-item-picker" }).length).toBe(0);
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
